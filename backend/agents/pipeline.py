"""LangGraph StateGraph 파이프라인 — filter→planner→validator→alternative→END."""
from langgraph.graph import StateGraph, END
from agents.state import ItineraryState
from agents.filter_agent import filter_agent
from agents.planner_agent import planner_agent
from agents.validator import validator_agent
from agents.alternative_agent import alternative_agent

_pipeline = None


def build_pipeline():
    """StateGraph를 조립하고 컴파일한다."""
    graph = StateGraph(ItineraryState)

    graph.add_node("filter", filter_agent)
    graph.add_node("planner", planner_agent)
    graph.add_node("validator", validator_agent)
    graph.add_node("alternative", alternative_agent)

    graph.set_entry_point("filter")
    graph.add_edge("filter", "planner")
    graph.add_edge("planner", "validator")
    graph.add_edge("validator", "alternative")
    graph.add_edge("alternative", END)

    return graph.compile()


def get_pipeline():
    """싱글턴 파이프라인 인스턴스를 반환한다. 최초 호출 시 컴파일된다."""
    global _pipeline
    if _pipeline is None:
        _pipeline = build_pipeline()
    return _pipeline
