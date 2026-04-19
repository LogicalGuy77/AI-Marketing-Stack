"""
MiroFish Slack bot — drop a .txt (reality seed) + message (simulation prompt)
in the listener channel, and the bot runs the full MiroFish pipeline and
posts the final report back to the same thread.

Pipeline: ontology -> graph -> create sim -> prepare -> start -> poll ->
generate report -> fetch markdown -> upload to Slack.

Run alongside `npm run dev` (needs backend on :5001).

Env (read from .env at repo root):
  SLACK_BOT_TOKEN       xoxb-...
  SLACK_APP_TOKEN       xapp-...
  SLACK_CHANNEL         channel name (e.g. mirofish) or ID (C0...)
  MIROFISH_BACKEND_URL  default http://localhost:5001
  MIROFISH_MAX_ROUNDS   default 20
"""

import io
import json
import os
import sys
import time
import traceback
from pathlib import Path

import asyncio
import requests
from dotenv import load_dotenv
from google import genai
from google.genai import types as gtypes
from livekit import api as lkapi
from openai import OpenAI
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

BACKEND = os.environ.get("MIROFISH_BACKEND_URL", "http://localhost:5001").rstrip("/")
MAX_ROUNDS = int(os.environ.get("MIROFISH_MAX_ROUNDS", "20"))
CHANNEL_ENV = os.environ.get("SLACK_CHANNEL", "").lstrip("#")
BOT_TOKEN = os.environ["SLACK_BOT_TOKEN"]
APP_TOKEN = os.environ["SLACK_APP_TOKEN"]

POLL_INTERVAL = 5
TIMEOUT_BUILD = 30 * 60
TIMEOUT_PREPARE = 30 * 60
TIMEOUT_RUN = 60 * 60
TIMEOUT_REPORT = 30 * 60

http = requests.Session()
http.headers.update({"Accept-Language": "en"})

llm = OpenAI(api_key=os.environ["LLM_API_KEY"], base_url=os.environ.get("LLM_BASE_URL"))
LLM_MODEL = os.environ.get("LLM_MODEL_NAME", "gpt-4o-mini")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
PROSPECTOR_MODEL = os.environ.get("PROSPECTOR_MODEL", "gemini-2.5-pro")
gemini = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")
LIVEKIT_AGENT_NAME = os.environ.get("LIVEKIT_AGENT_NAME", "rasana-test")
LIVEKIT_OUTBOUND_TRUNK_ID = os.environ.get("LIVEKIT_OUTBOUND_TRUNK_ID", "")

LATEST_REPORT: dict[str, dict] = {}

app = App(token=BOT_TOKEN)


def resolve_channel_id(name_or_id: str) -> str:
    if name_or_id.startswith(("C", "G", "D")):
        return name_or_id
    cursor = None
    while True:
        resp = app.client.conversations_list(
            cursor=cursor, limit=200, types="public_channel,private_channel"
        )
        for ch in resp["channels"]:
            if ch["name"] == name_or_id:
                return ch["id"]
        cursor = resp.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            raise RuntimeError(f"Channel not found: {name_or_id}")


CHANNEL_ID = resolve_channel_id(CHANNEL_ENV) if CHANNEL_ENV else None


def say(channel: str, thread_ts: str, text: str):
    app.client.chat_postMessage(channel=channel, thread_ts=thread_ts, text=text)


def fetch_slack_file(url: str) -> bytes:
    r = requests.get(url, headers={"Authorization": f"Bearer {BOT_TOKEN}"}, timeout=60)
    r.raise_for_status()
    return r.content


def api_post(path: str, **kwargs):
    r = http.post(f"{BACKEND}{path}", timeout=120, **kwargs)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise RuntimeError(f"{path} failed: {data.get('error')}")
    return data["data"]


def api_get(path: str, **kwargs):
    r = http.get(f"{BACKEND}{path}", timeout=60, **kwargs)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise RuntimeError(f"{path} failed: {data.get('error')}")
    return data["data"]


def poll(fn, done_predicate, timeout: int, label: str, channel: str, thread_ts: str):
    start = time.time()
    last_msg = ""
    while time.time() - start < timeout:
        data = fn()
        msg = f"{data.get('status', '?')} {data.get('progress', '')}% {data.get('message', '')}".strip()
        if msg != last_msg:
            print(f"[{label}] {msg}")
            last_msg = msg
        done, ok = done_predicate(data)
        if done:
            if not ok:
                raise RuntimeError(f"{label} failed: {data}")
            return data
        time.sleep(POLL_INTERVAL)
    raise TimeoutError(f"{label} timed out after {timeout}s")


def run_pipeline(seed_bytes: bytes, seed_filename: str, prompt: str,
                 channel: str, thread_ts: str) -> dict:
    say(channel, thread_ts, f":gear: Step 1/6 — ontology generation (uploading `{seed_filename}`)")
    files = {"files": (seed_filename, seed_bytes, "text/plain")}
    form = {"simulation_requirement": prompt, "project_name": f"slack-{int(time.time())}"}
    d = api_post("/api/graph/ontology/generate", files=files, data=form)
    project_id = d["project_id"]
    say(channel, thread_ts,
        f":white_check_mark: project `{project_id}` — {len(d['ontology'].get('entity_types', []))} entity types\n"
        f":link: live in MiroFish UI: http://localhost:3000/process/{project_id}")

    say(channel, thread_ts, ":gear: Step 2/6 — building knowledge graph")
    d = api_post("/api/graph/build", json={"project_id": project_id})
    task_id = d["task_id"]

    def get_task():
        return api_get(f"/api/graph/task/{task_id}")

    def graph_done(s):
        st = s.get("status")
        if st == "completed":
            return True, True
        if st == "failed":
            return True, False
        return False, False

    result = poll(get_task, graph_done, TIMEOUT_BUILD, "graph.build", channel, thread_ts)
    graph_id = result.get("result", {}).get("graph_id")
    say(channel, thread_ts, f":white_check_mark: graph `{graph_id}` built")

    say(channel, thread_ts, ":gear: Step 3/6 — creating + preparing simulation")
    sim = api_post("/api/simulation/create", json={"project_id": project_id})
    sim_id = sim["simulation_id"]
    api_post("/api/simulation/prepare", json={"simulation_id": sim_id})

    def prep_status():
        return api_post("/api/simulation/prepare/status", json={"simulation_id": sim_id})

    def prep_done(s):
        st = s.get("status")
        if st in ("ready", "completed") or s.get("already_prepared"):
            return True, True
        if st == "failed":
            return True, False
        return False, False

    poll(prep_status, prep_done, TIMEOUT_PREPARE, "sim.prepare", channel, thread_ts)
    say(channel, thread_ts, f":white_check_mark: simulation `{sim_id}` prepared")

    say(channel, thread_ts, f":gear: Step 4/6 — running simulation (max_rounds={MAX_ROUNDS})")
    api_post("/api/simulation/start",
             json={"simulation_id": sim_id, "platform": "parallel", "max_rounds": MAX_ROUNDS})

    def run_status():
        return api_get(f"/api/simulation/{sim_id}/run-status")

    def run_done(s):
        st = s.get("runner_status")
        if st in ("completed", "stopped"):
            return True, True
        if st == "failed":
            return True, False
        return False, False

    poll(run_status, run_done, TIMEOUT_RUN, "sim.run", channel, thread_ts)
    say(channel, thread_ts, ":white_check_mark: simulation finished")

    say(channel, thread_ts, ":gear: Step 5/6 — generating report")
    rep = api_post("/api/report/generate", json={"simulation_id": sim_id})
    report_id = rep["report_id"]
    task_id = rep.get("task_id")

    def report_status():
        return api_post("/api/report/generate/status",
                        json={"task_id": task_id, "simulation_id": sim_id})

    def report_done(s):
        st = s.get("status")
        if st == "completed" or s.get("already_completed"):
            return True, True
        if st == "failed":
            return True, False
        return False, False

    poll(report_status, report_done, TIMEOUT_REPORT, "report.generate", channel, thread_ts)

    say(channel, thread_ts, ":gear: Step 6/6 — fetching final report")
    report = api_get(f"/api/report/{report_id}")
    return {"sim_id": sim_id, "report_id": report_id, "markdown": report.get("markdown_content", "")}


def post_report(channel: str, thread_ts: str, result: dict):
    md = result["markdown"] or "(empty report)"
    filename = f"{result['report_id']}.md"
    app.client.files_upload_v2(
        channel=channel,
        thread_ts=thread_ts,
        filename=filename,
        content=md,
        initial_comment=f":sparkles: Report ready — sim `{result['sim_id']}`, report `{result['report_id']}`",
    )
    LATEST_REPORT[channel] = {"markdown": md, "sim_id": result["sim_id"],
                              "report_id": result["report_id"], "thread_ts": thread_ts}
    post_agent_menu(channel, thread_ts)


def post_agent_menu(channel: str, thread_ts: str):
    app.client.chat_postMessage(
        channel=channel,
        thread_ts=thread_ts,
        text="Pick an agent to run against this report:",
        blocks=[
            {"type": "section", "text": {"type": "mrkdwn",
             "text": "*Spin up an agent* — runs against the report above."}},
            {"type": "actions", "elements": [
                {"type": "button", "style": "primary",
                 "text": {"type": "plain_text", "text": "Writer Agent"},
                 "action_id": "agent_writer", "value": "writer"},
                {"type": "button",
                 "text": {"type": "plain_text", "text": "Outreacher Agent (stub)"},
                 "action_id": "agent_outreacher", "value": "outreacher"},
                {"type": "button",
                 "text": {"type": "plain_text", "text": "Analyst Agent (stub)"},
                 "action_id": "agent_analyst", "value": "analyst"},
                {"type": "button", "style": "danger",
                 "text": {"type": "plain_text", "text": "Voice Reachout"},
                 "action_id": "agent_voice", "value": "voice"},
                {"type": "button",
                 "text": {"type": "plain_text", "text": "Prospector Agent"},
                 "action_id": "agent_prospector", "value": "prospector"},
            ]},
        ],
    )


WRITER_CHANNELS = [
    ("x_long", "X — long-form thread"),
    ("x_short", "X — short post"),
    ("linkedin", "LinkedIn post"),
    ("hn_show", "Show HN post"),
    ("reddit", "Reddit (r/LocalLLaMA style)"),
    ("newsletter_sponsor", "Newsletter sponsorship copy"),
    ("cold_dm", "Cold DM (X/LinkedIn)"),
]


def writer_modal(trigger_id: str, channel_id: str, thread_ts: str):
    app.client.views_open(trigger_id=trigger_id, view={
        "type": "modal",
        "callback_id": "writer_submit",
        "private_metadata": json.dumps({"channel": channel_id, "thread_ts": thread_ts}),
        "title": {"type": "plain_text", "text": "Writer Agent"},
        "submit": {"type": "plain_text", "text": "Generate"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "blocks": [
            {"type": "input", "block_id": "ch",
             "label": {"type": "plain_text", "text": "Channel"},
             "element": {"type": "static_select", "action_id": "v",
                         "options": [{"text": {"type": "plain_text", "text": label},
                                      "value": key} for key, label in WRITER_CHANNELS]}},
            {"type": "input", "block_id": "topic", "optional": True,
             "label": {"type": "plain_text", "text": "Topic / angle (optional)"},
             "element": {"type": "plain_text_input", "action_id": "v",
                         "placeholder": {"type": "plain_text",
                                         "text": "e.g. latency shootout vs Vapi"}}},
            {"type": "input", "block_id": "n", "optional": True,
             "label": {"type": "plain_text", "text": "How many drafts?"},
             "element": {"type": "static_select", "action_id": "v",
                         "initial_option": {"text": {"type": "plain_text", "text": "3"}, "value": "3"},
                         "options": [{"text": {"type": "plain_text", "text": str(i)},
                                      "value": str(i)} for i in (1, 3, 5)]}},
        ],
    })


WRITER_SYSTEM = """You are the Writer Agent for a solo founder running a voice AI startup (Vocaly).
You produce ready-to-publish copy that the founder can paste verbatim.

Voice rules (non-negotiable — from the reality seed):
- Metrics-forward, dry, technical, zero hype.
- NEVER use: "AI-powered", "revolutionize", "unlock", "game-changer", "10x", "supercharge",
  "seamlessly", em-dashes as rhetorical flourish, rhetorical questions, emoji soup.
- Specific numbers > vague claims. "sub-400ms end-to-end" > "fast".
- Founder voice: strong infra background, 4.1k X followers of devs/infra engineers.
- No humblebrag, no inspirational closer, no "DM me" soft-sell unless channel demands it.

Channel format rules:
- x_long: 5-8 tweets, each ≤280 chars, numbered like "1/", concrete and specific. Opens with a
  counterintuitive fact or a real number, not a hook question.
- x_short: single tweet ≤280 chars. One specific observation or number.
- linkedin: 1200-1800 chars. Personal-story hook → specific lesson → one metric. No hashtags.
- hn_show: Show HN-style post (~150 words). Lead with what it does + what's interesting
  technically. End with "Happy to answer questions."
- reddit: r/LocalLLaMA tone — technical depth post, warts-and-all. No self-promo copy.
- newsletter_sponsor: 80-120 word sponsorship blurb written to the reader, not about Vocaly.
- cold_dm: 3 sentences max. Reference something specific to the recipient. Low-pressure ask.

Output: return the drafts and nothing else. Number them. Each draft in a fenced code block
so the user can one-click copy. No commentary before, between, or after."""


def writer_generate(channel_key: str, topic: str, n: int, report_md: str) -> str:
    context = (report_md or "")[:12000]
    user = f"""Report excerpt below. Produce {n} distinct drafts for channel: {channel_key}.

Topic / angle: {topic or '(pick the strongest angle from the report)'}

---REPORT---
{context}
---END---

Return only the numbered drafts in fenced code blocks."""
    r = llm.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "system", "content": WRITER_SYSTEM},
                  {"role": "user", "content": user}],
        temperature=0.7,
    )
    return r.choices[0].message.content.strip()


@app.action("agent_writer")
def on_agent_writer(ack, body, client):
    ack()
    channel_id = body["channel"]["id"]
    thread_ts = body["message"].get("thread_ts") or body["message"]["ts"]
    if channel_id not in LATEST_REPORT:
        client.chat_postMessage(channel=channel_id, thread_ts=thread_ts,
                                text=":warning: no report yet in this channel — run a simulation first.")
        return
    writer_modal(body["trigger_id"], channel_id, thread_ts)


@app.view("writer_submit")
def on_writer_submit(ack, body, client):
    ack()
    meta = json.loads(body["view"]["private_metadata"])
    channel = meta["channel"]
    thread_ts = meta["thread_ts"]
    values = body["view"]["state"]["values"]
    ch_key = values["ch"]["v"]["selected_option"]["value"]
    ch_label = dict(WRITER_CHANNELS)[ch_key]
    topic = (values.get("topic", {}).get("v", {}) or {}).get("value", "") or ""
    n = int((values.get("n", {}).get("v", {}) or {}).get("selected_option", {}).get("value", "3"))

    report = LATEST_REPORT.get(channel, {}).get("markdown", "")
    client.chat_postMessage(channel=channel, thread_ts=thread_ts,
                            text=f":writing_hand: Writer Agent — generating {n} drafts for *{ch_label}*" +
                                 (f" on _{topic}_" if topic else ""))
    try:
        out = writer_generate(ch_key, topic, n, report)
        client.chat_postMessage(channel=channel, thread_ts=thread_ts,
                                text=out or "(empty)")
    except Exception as e:
        traceback.print_exc()
        client.chat_postMessage(channel=channel, thread_ts=thread_ts,
                                text=f":x: Writer Agent failed: `{e}`")


@app.action("agent_outreacher")
def on_agent_outreacher(ack, body, client):
    ack()
    channel_id = body["channel"]["id"]
    thread_ts = body["message"].get("thread_ts") or body["message"]["ts"]
    client.chat_postMessage(channel=channel_id, thread_ts=thread_ts,
        text=":construction: *Outreacher Agent* — stub. Will personalize cold DMs to founders "
             "who recently tweeted about voice agents. Needs Apollo/Clay + send integration.")


@app.action("agent_analyst")
def on_agent_analyst(ack, body, client):
    ack()
    channel_id = body["channel"]["id"]
    thread_ts = body["message"].get("thread_ts") or body["message"]["ts"]
    client.chat_postMessage(channel=channel_id, thread_ts=thread_ts,
        text=":construction: *Analyst Agent* — stub. Will pull weekly MRR, trial-to-paid, churn, "
             "and flag drift vs. the report's predicted trajectory. Needs Stripe + analytics hookup.")


VOICE_BRIEF_SYSTEM = """Extract a concise call brief from a marketing simulation report.
Output rules:
- Max 1200 characters.
- Pure plain text, no markdown, no lists, no headers.
- Focus: who the ideal prospect is, top 3 pain points this product solves, one-line pitch, pricing, the one action the agent should ask for on the call (demo, 500 free minutes, email follow-up).
- No hedging, no caveats, no section labels."""


def build_voice_brief(report_md: str) -> str:
    ctx = (report_md or "")[:12000]
    r = llm.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "system", "content": VOICE_BRIEF_SYSTEM},
                  {"role": "user", "content": f"Report:\n{ctx}\n\nProduce the call brief."}],
        temperature=0.3,
    )
    return (r.choices[0].message.content or "").strip()[:1500]


def voice_modal(trigger_id: str, channel_id: str, thread_ts: str):
    app.client.views_open(trigger_id=trigger_id, view={
        "type": "modal",
        "callback_id": "voice_submit",
        "private_metadata": json.dumps({"channel": channel_id, "thread_ts": thread_ts}),
        "title": {"type": "plain_text", "text": "Voice Reachout"},
        "submit": {"type": "plain_text", "text": "Call now"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "blocks": [
            {"type": "input", "block_id": "phone",
             "label": {"type": "plain_text", "text": "Phone number (E.164, e.g. +919304529722)"},
             "element": {"type": "plain_text_input", "action_id": "v",
                         "placeholder": {"type": "plain_text", "text": "+919304529722"}}},
            {"type": "input", "block_id": "name", "optional": True,
             "label": {"type": "plain_text", "text": "Prospect name (optional)"},
             "element": {"type": "plain_text_input", "action_id": "v"}},
            {"type": "input", "block_id": "context", "optional": True,
             "label": {"type": "plain_text", "text": "Extra context (optional)"},
             "element": {"type": "plain_text_input", "action_id": "v", "multiline": True,
                         "placeholder": {"type": "plain_text",
                                         "text": "e.g. founder tweeted about building a voice agent"}}},
        ],
    })


async def place_call_async(phone: str, prospect_name: str, context: str, brief: str) -> dict:
    lk = lkapi.LiveKitAPI(url=LIVEKIT_URL, api_key=LIVEKIT_API_KEY, api_secret=LIVEKIT_API_SECRET)
    try:
        room_name = f"voice-reachout-{int(time.time())}"
        identity = f"prospect-{phone.lstrip('+')}"

        metadata = json.dumps({
            "to": phone, "prospect_name": prospect_name or "",
            "context": context or "", "brief": brief,
        })

        await lk.agent_dispatch.create_dispatch(
            lkapi.CreateAgentDispatchRequest(
                agent_name=LIVEKIT_AGENT_NAME, room=room_name, metadata=metadata,
            )
        )

        sip_participant = await lk.sip.create_sip_participant(
            lkapi.CreateSIPParticipantRequest(
                sip_trunk_id=LIVEKIT_OUTBOUND_TRUNK_ID,
                sip_call_to=phone,
                room_name=room_name,
                participant_identity=identity,
                participant_name=prospect_name or phone,
                wait_until_answered=False,
            )
        )
        return {"room": room_name, "participant": sip_participant.participant_identity}
    finally:
        await lk.aclose()


def place_call(phone: str, prospect_name: str, context: str, brief: str) -> dict:
    return asyncio.run(place_call_async(phone, prospect_name, context, brief))


@app.action("agent_voice")
def on_agent_voice(ack, body, client):
    ack()
    channel_id = body["channel"]["id"]
    thread_ts = body["message"].get("thread_ts") or body["message"]["ts"]
    if not all([LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_OUTBOUND_TRUNK_ID]):
        client.chat_postMessage(channel=channel_id, thread_ts=thread_ts,
            text=":x: LiveKit env vars missing — check LIVEKIT_URL / LIVEKIT_API_KEY / "
                 "LIVEKIT_API_SECRET / LIVEKIT_OUTBOUND_TRUNK_ID in .env")
        return
    if channel_id not in LATEST_REPORT:
        client.chat_postMessage(channel=channel_id, thread_ts=thread_ts,
                                text=":warning: no report yet in this channel — run a simulation first.")
        return
    voice_modal(body["trigger_id"], channel_id, thread_ts)


@app.view("voice_submit")
def on_voice_submit(ack, body, client):
    ack()
    meta = json.loads(body["view"]["private_metadata"])
    channel = meta["channel"]
    thread_ts = meta["thread_ts"]
    values = body["view"]["state"]["values"]
    phone = values["phone"]["v"]["value"].strip()
    prospect_name = (values.get("name", {}).get("v", {}) or {}).get("value", "") or ""
    context = (values.get("context", {}).get("v", {}) or {}).get("value", "") or ""

    if not phone.startswith("+") or len(phone) < 8:
        client.chat_postMessage(channel=channel, thread_ts=thread_ts,
            text=f":x: phone must be E.164 (start with +). Got: `{phone}`")
        return

    report = LATEST_REPORT.get(channel, {}).get("markdown", "")
    client.chat_postMessage(channel=channel, thread_ts=thread_ts,
        text=f":telephone_receiver: Voice Reachout — condensing report into a call brief for `{phone}`…")
    try:
        brief = build_voice_brief(report)
    except Exception as e:
        traceback.print_exc()
        client.chat_postMessage(channel=channel, thread_ts=thread_ts,
            text=f":x: brief generation failed: `{e}`")
        return

    client.chat_postMessage(channel=channel, thread_ts=thread_ts,
        text=f":gear: dispatching agent `{LIVEKIT_AGENT_NAME}` and dialing `{phone}`…")
    try:
        result = place_call(phone, prospect_name, context, brief)
        client.chat_postMessage(channel=channel, thread_ts=thread_ts,
            text=f":phone: call initiated — room `{result['room']}`, participant `{result['participant']}`. "
                 f"Pick up when it rings.\n*Brief sent to agent:* ```{brief[:900]}```")
    except Exception as e:
        traceback.print_exc()
        client.chat_postMessage(channel=channel, thread_ts=thread_ts,
            text=f":x: call failed: `{e}`")


def handle_submission(event, channel: str, thread_ts: str):
    files = event.get("files") or []
    txt_files = [f for f in files if f.get("name", "").lower().endswith(".txt")]
    if not txt_files:
        say(channel, thread_ts, ":warning: attach a `.txt` reality seed with your prompt")
        return
    prompt = (event.get("text") or "").strip()
    if not prompt:
        say(channel, thread_ts, ":warning: include your simulation prompt as the message text")
        return
    seed = txt_files[0]
    try:
        seed_bytes = fetch_slack_file(seed["url_private_download"])
    except Exception as e:
        say(channel, thread_ts, f":x: couldn't download file: {e}")
        return

    say(channel, thread_ts, f":rocket: starting MiroFish pipeline ({len(seed_bytes)} bytes seed, prompt {len(prompt)} chars)")
    try:
        result = run_pipeline(seed_bytes, seed["name"], prompt, channel, thread_ts)
        post_report(channel, thread_ts, result)
    except Exception as e:
        traceback.print_exc()
        say(channel, thread_ts, f":x: pipeline failed: `{e}`")


PROSPECTOR_SEARCH_SYSTEM = """You research real people online for a B2B outreach agent.

Task: given an ICP description and a product brief, use web_search to find N real candidates
who are strong fits. Prefer candidates with recent (last 90 days) public activity that
signals the pain point the product solves.

For each candidate, return STRICT JSON (no prose, no markdown) like:
{
  "candidates": [
    {
      "name": "full name",
      "role": "title at company",
      "company": "company name",
      "icp_score": 1-10,
      "why_fit": "one sentence tied to their real, recent, public activity",
      "hook": "a specific opening line referencing that activity",
      "evidence_url": "the single strongest public URL supporting the above",
      "handle_or_link": "X @handle, LinkedIn URL, or GitHub URL — pick whichever is most real"
    }
  ]
}

Rules:
- Only include candidates whose names and claims you can cite to a real URL.
- No invented companies. No vague hooks. No marketing fluff.
- If you cannot find N solid candidates, return fewer — never pad with weak ones."""


PROSPECTOR_VERIFY_SYSTEM = """You verify prospecting leads.

For each candidate, use web_search to confirm:
1. The person and company exist.
2. The claimed recent activity is real and publicly visible at the evidence URL.
3. The hook accurately reflects that activity.

Return STRICT JSON (no prose, no markdown):
{
  "verified": [
    {
      "name": "...",
      "verdict": "verified" | "partially_verified" | "unverified",
      "verified_claims": ["..."],
      "failed_claims": ["..."],
      "corrected_hook": "..." | null
    }
  ]
}

- "verified": all claims check out, hook is accurate.
- "partially_verified": person/company real, but hook references something you cannot confirm.
- "unverified": cannot confirm person exists, or evidence URL is dead/unrelated.
- Be strict. A demo that calls the wrong person is worse than a demo with fewer leads."""


def _extract_json(text: str) -> dict:
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1]
        if t.startswith("json"):
            t = t[4:]
        t = t.rsplit("```", 1)[0]
    start = t.find("{")
    end = t.rfind("}")
    if start >= 0 and end > start:
        t = t[start:end + 1]
    return json.loads(t)


def _gemini_search(system: str, user: str) -> str:
    if not gemini:
        raise RuntimeError("GEMINI_API_KEY not set")
    r = gemini.models.generate_content(
        model=PROSPECTOR_MODEL,
        contents=user,
        config=gtypes.GenerateContentConfig(
            system_instruction=system,
            tools=[gtypes.Tool(google_search=gtypes.GoogleSearch())],
            temperature=0.2,
        ),
    )
    return r.text or ""


def prospector_search(icp_desc: str, product_brief: str, n: int) -> list[dict]:
    prompt = (f"ICP:\n{icp_desc}\n\nProduct brief:\n{product_brief}\n\n"
              f"Use Google Search to find {n} real candidates active in the last 90 days. "
              "Return ONLY the JSON object described, no prose before or after.")
    text = _gemini_search(PROSPECTOR_SEARCH_SYSTEM, prompt)
    data = _extract_json(text)
    return data.get("candidates", [])[:n]


def prospector_verify(candidates: list[dict]) -> list[dict]:
    if not candidates:
        return []
    prompt = ("Verify each candidate below by searching the web for their name, company, and "
              "evidence URL. Return ONLY the JSON object described, no prose.\n\n"
              + json.dumps({"candidates": candidates}, indent=2))
    text = _gemini_search(PROSPECTOR_VERIFY_SYSTEM, prompt)
    data = _extract_json(text)
    verdicts = {v["name"]: v for v in data.get("verified", []) if v.get("name")}
    merged = []
    for c in candidates:
        v = verdicts.get(c.get("name"), {})
        c["verdict"] = v.get("verdict", "unverified")
        c["verified_claims"] = v.get("verified_claims", [])
        c["failed_claims"] = v.get("failed_claims", [])
        if v.get("corrected_hook"):
            c["hook"] = v["corrected_hook"]
        merged.append(c)
    return merged


def extract_icp_from_report(report_md: str) -> str:
    ctx = (report_md or "")[:8000]
    r = llm.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system",
             "content": "Extract the primary ICP from the report as a 3-5 sentence description. "
                        "Include: titles, company stage, tech stack they likely use, specific pain points "
                        "that signal they need this product. No markdown."},
            {"role": "user", "content": f"Report:\n{ctx}"},
        ],
        temperature=0.2,
    )
    return (r.choices[0].message.content or "").strip()


def extract_product_brief(report_md: str) -> str:
    ctx = (report_md or "")[:8000]
    r = llm.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system",
             "content": "Write a 3-sentence product brief: what it is, who it's for, the specific pain "
                        "it solves. Metrics-forward, no hype. No markdown."},
            {"role": "user", "content": f"Report:\n{ctx}"},
        ],
        temperature=0.2,
    )
    return (r.choices[0].message.content or "").strip()


def prospector_modal(trigger_id: str, channel_id: str, thread_ts: str):
    app.client.views_open(trigger_id=trigger_id, view={
        "type": "modal",
        "callback_id": "prospector_submit",
        "private_metadata": json.dumps({"channel": channel_id, "thread_ts": thread_ts}),
        "title": {"type": "plain_text", "text": "Prospector Agent"},
        "submit": {"type": "plain_text", "text": "Find prospects"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "blocks": [
            {"type": "input", "block_id": "n", "optional": True,
             "label": {"type": "plain_text", "text": "How many candidates?"},
             "element": {"type": "static_select", "action_id": "v",
                         "initial_option": {"text": {"type": "plain_text", "text": "3"}, "value": "3"},
                         "options": [{"text": {"type": "plain_text", "text": str(i)},
                                      "value": str(i)} for i in (3, 5, 10)]}},
            {"type": "input", "block_id": "override", "optional": True,
             "label": {"type": "plain_text", "text": "ICP override (optional)"},
             "element": {"type": "plain_text_input", "action_id": "v", "multiline": True,
                         "placeholder": {"type": "plain_text",
                                         "text": "Leave blank to use ICP from the report"}}},
        ],
    })


def render_prospect_blocks(candidates: list[dict]) -> list[dict]:
    blocks = [{"type": "section", "text": {"type": "mrkdwn",
               "text": f":dart: *Prospector Agent* — {len(candidates)} verified candidates"}}]
    verdict_emoji = {"verified": ":white_check_mark:",
                     "partially_verified": ":warning:",
                     "unverified": ":x:"}
    for i, c in enumerate(candidates, 1):
        em = verdict_emoji.get(c.get("verdict", "unverified"), ":grey_question:")
        lines = [
            f"{em} *{i}. {c.get('name','?')}* — {c.get('role','?')} @ {c.get('company','?')} "
            f"(ICP {c.get('icp_score','?')}/10)",
            f"*Why fit:* {c.get('why_fit','')}",
            f"*Hook:* {c.get('hook','')}",
        ]
        if c.get("evidence_url"):
            lines.append(f"*Evidence:* {c['evidence_url']}")
        if c.get("handle_or_link"):
            lines.append(f"*Profile:* {c['handle_or_link']}")
        if c.get("failed_claims"):
            lines.append(f"*Failed checks:* {', '.join(c['failed_claims'])}")
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)}})
    blocks.append({"type": "context", "elements": [{"type": "mrkdwn",
        "text": "_Tip: pipe a hook into Writer Agent for a DM draft, or use Voice Reachout if you have their number._"}]})
    return blocks


@app.action("agent_prospector")
def on_agent_prospector(ack, body, client):
    ack()
    channel_id = body["channel"]["id"]
    thread_ts = body["message"].get("thread_ts") or body["message"]["ts"]
    if not GEMINI_API_KEY:
        client.chat_postMessage(channel=channel_id, thread_ts=thread_ts,
            text=":x: GEMINI_API_KEY not set in .env")
        return
    if channel_id not in LATEST_REPORT:
        client.chat_postMessage(channel=channel_id, thread_ts=thread_ts,
                                text=":warning: no report yet in this channel — run a simulation first.")
        return
    prospector_modal(body["trigger_id"], channel_id, thread_ts)


@app.view("prospector_submit")
def on_prospector_submit(ack, body, client):
    ack()
    meta = json.loads(body["view"]["private_metadata"])
    channel = meta["channel"]
    thread_ts = meta["thread_ts"]
    values = body["view"]["state"]["values"]
    n = int((values.get("n", {}).get("v", {}) or {}).get("selected_option", {}).get("value", "3"))
    override = (values.get("override", {}).get("v", {}) or {}).get("value", "") or ""

    report = LATEST_REPORT.get(channel, {}).get("markdown", "")
    client.chat_postMessage(channel=channel, thread_ts=thread_ts,
        text=f":mag: Prospector Agent — searching for {n} real candidates via web search…")

    try:
        icp_desc = override.strip() or extract_icp_from_report(report)
        product_brief = extract_product_brief(report)
        client.chat_postMessage(channel=channel, thread_ts=thread_ts,
            text=f":bookmark_tabs: *ICP:* {icp_desc[:400]}")
        candidates = prospector_search(icp_desc, product_brief, n)
        if not candidates:
            client.chat_postMessage(channel=channel, thread_ts=thread_ts,
                text=":x: no candidates returned from web search")
            return
        client.chat_postMessage(channel=channel, thread_ts=thread_ts,
            text=f":repeat: verifying {len(candidates)} candidates via a second web-search pass…")
        verified = prospector_verify(candidates)
        client.chat_postMessage(channel=channel, thread_ts=thread_ts,
            blocks=render_prospect_blocks(verified),
            text=f"Prospector Agent: {len(verified)} candidates")
    except Exception as e:
        traceback.print_exc()
        client.chat_postMessage(channel=channel, thread_ts=thread_ts,
            text=f":x: Prospector Agent failed: `{e}`")


@app.event("message")
def on_message(event, logger):
    if event.get("subtype") in ("bot_message", "message_changed", "message_deleted"):
        return
    if event.get("bot_id"):
        return
    channel = event["channel"]
    if CHANNEL_ID and channel != CHANNEL_ID:
        return
    if not event.get("files"):
        return
    thread_ts = event.get("thread_ts") or event["ts"]
    handle_submission(event, channel, thread_ts)


@app.event("file_shared")
def on_file_shared(event, logger):
    return


@app.event("app_mention")
def on_mention(event, say_fn):
    text = (event.get("text") or "").lower()
    thread_ts = event.get("thread_ts") or event["ts"]
    channel = event["channel"]
    if "agent" in text:
        if channel not in LATEST_REPORT:
            say_fn(thread_ts=thread_ts,
                   text=":warning: no report yet in this channel — run a simulation first.")
            return
        post_agent_menu(channel, thread_ts)
        return
    say_fn(thread_ts=thread_ts,
           text="Drop a `.txt` reality seed with your simulation prompt as the message text. "
                "After the report lands, type `@MiroFish Bot agents` to run an agent against it.")


def preload_latest_report():
    if not CHANNEL_ID:
        return
    try:
        sims = http.get(f"{BACKEND}/api/simulation/list", timeout=10).json().get("data", [])
        sims.sort(key=lambda s: s.get("created_at") or s.get("updated_at") or "", reverse=True)
        for s in sims:
            sid = s.get("simulation_id")
            try:
                report = http.get(f"{BACKEND}/api/report/by-simulation/{sid}", timeout=10).json()
                if report.get("success"):
                    rd = report["data"]
                    if rd.get("status") == "completed" and rd.get("markdown_content"):
                        LATEST_REPORT[CHANNEL_ID] = {
                            "markdown": rd["markdown_content"],
                            "sim_id": sid,
                            "report_id": rd.get("report_id"),
                            "thread_ts": None,
                        }
                        print(f"[bot] preloaded report {rd.get('report_id')} for sim {sid}")
                        return
            except Exception:
                continue
    except Exception as e:
        print(f"[bot] preload skipped: {e}", file=sys.stderr)


if __name__ == "__main__":
    print(f"[bot] backend={BACKEND}  channel={CHANNEL_ENV or '(any)'}  max_rounds={MAX_ROUNDS}")
    try:
        requests.get(f"{BACKEND}/health", timeout=3)
    except Exception as e:
        print(f"[bot] WARNING: backend not reachable at {BACKEND}: {e}", file=sys.stderr)
    preload_latest_report()
    SocketModeHandler(app, APP_TOKEN).start()
