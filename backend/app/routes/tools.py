import json
import sys
from dataclasses import asdict
from tempfile import TemporaryDirectory
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends

from app.schemas.tools import ContextFilterRequest, DataTreatmentRequest, MarketRadarRequest
from app.security import require_api_key

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.context_filter import filter_context
from scripts.market_radar import collect_signals
from scripts.treat_dataset import treat_dataset


router = APIRouter(dependencies=[Depends(require_api_key)])


@router.post("/context-filter")
def context_filter(request: ContextFilterRequest) -> dict[str, object]:
    filtered, report = filter_context(request.text, max_chars=request.max_chars)
    return {"filtered_text": filtered, "report": asdict(report)}


@router.post("/data-treatment")
def data_treatment(request: DataTreatmentRequest) -> dict[str, object]:
    with TemporaryDirectory(prefix="synapse-data-treatment-") as temp_dir:
        root = Path(temp_dir)
        input_path = root / "input.json"
        output_path = root / "treated.json"
        report_path = root / "report.md"
        pd.DataFrame(request.records).to_json(input_path, orient="records", force_ascii=False)
        result = treat_dataset(
            input_path,
            output_path=output_path,
            report_path=report_path,
            winsorize_outliers=request.winsorize_outliers,
        )
        treated_records = json.loads(output_path.read_text(encoding="utf-8"))
        return {
            "records": treated_records,
            "report_markdown": report_path.read_text(encoding="utf-8"),
            "summary": {
                "rows_before": result.rows_before,
                "rows_after": result.rows_after,
                "columns_before": result.columns_before,
                "columns_after": result.columns_after,
                "actions": result.actions,
                "warnings": result.warnings,
            },
        }


@router.post("/market-radar")
def market_radar(request: MarketRadarRequest) -> dict[str, object]:
    signals, raw_sources = collect_signals(offline=request.offline)
    return {
        "signals": [asdict(signal) for signal in signals],
        "source_status": {key: len(value) for key, value in raw_sources.items()},
        "fallback_used": not bool(raw_sources),
    }
