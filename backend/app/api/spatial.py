"""
Spatial simulation API — standalone endpoints for the 3D city sim.

Independent of graph-build / OASIS / report. Frontend polls /state for new
per-tick snapshots and fetches /report once status == 'done'.
"""

from flask import jsonify, request

from ..services import spatial_runner
from ..services.spatial_scenario_generator import SpatialScenarioGenerator
from . import spatial_bp


@spatial_bp.route("/scenarios", methods=["GET"])
def scenarios():
    return jsonify({
        "scenarios": spatial_runner.list_scenarios(),
        "zones": spatial_runner.get_zones(),
        "total_ticks": spatial_runner.TOTAL_TICKS,
        "grid": {"w": spatial_runner.GRID_W, "h": spatial_runner.GRID_H},
    })


@spatial_bp.route("/generate", methods=["POST"])
def generate():
    body = request.get_json(silent=True) or {}
    graph_id = body.get("graph_id")
    requirement = body.get("requirement", "")
    if not graph_id:
        return jsonify({"error": "graph_id required"}), 400
    try:
        gen = SpatialScenarioGenerator()
        scenario = gen.generate(graph_id=graph_id, requirement=requirement)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"scenario": scenario})


@spatial_bp.route("/start", methods=["POST"])
def start():
    body = request.get_json(silent=True) or {}
    scenario_id = body.get("scenario")
    scenario_dict = body.get("scenario_dict")
    try:
        simulation_id = spatial_runner.start_simulation(
            scenario_id=scenario_id, scenario_dict=scenario_dict
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    effective_id = scenario_id or (scenario_dict.get("id") if scenario_dict else None)
    return jsonify({"simulation_id": simulation_id, "scenario": effective_id})


@spatial_bp.route("/<sim_id>/state", methods=["GET"])
def state(sim_id: str):
    since = int(request.args.get("since", -1))
    data = spatial_runner.get_state_since(sim_id, since)
    if "error" in data:
        return jsonify(data), 404
    return jsonify(data)


@spatial_bp.route("/<sim_id>/report", methods=["GET"])
def report(sim_id: str):
    rep = spatial_runner.get_report(sim_id)
    if rep is None:
        return jsonify({"error": "not_ready"}), 404
    return jsonify(rep)


@spatial_bp.route("/<sim_id>/interview", methods=["POST"])
def interview(sim_id: str):
    body = request.get_json(silent=True) or {}
    agent_id = body.get("agent_id")
    question = (body.get("question") or "").strip()
    if not agent_id or not question:
        return jsonify({"error": "agent_id and question required"}), 400
    result = spatial_runner.interview_agent(sim_id, agent_id, question)
    if "error" in result:
        return jsonify(result), 404
    return jsonify(result)


@spatial_bp.route("/runs", methods=["GET"])
def list_runs():
    """List persisted runs from outputs/spatial/ (newest first)."""
    return jsonify({"runs": spatial_runner.list_persisted_runs()})


@spatial_bp.route("/runs/<sim_id>", methods=["GET"])
def load_run(sim_id: str):
    """Load a persisted run's full payload (snapshots + report) without re-running."""
    data = spatial_runner.load_persisted_run(sim_id)
    if data is None:
        return jsonify({"error": "not_found"}), 404
    return jsonify(data)
