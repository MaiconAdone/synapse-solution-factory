$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Errors = New-Object System.Collections.Generic.List[string]

function Require-Path {
    param([string]$Path)
    if (!(Test-Path $Path)) {
        $Errors.Add("Arquivo ou pasta ausente: $Path")
    }
}

Require-Path ".mcp.json"
Require-Path "config\runtime_manifest.json"
Require-Path "config\ai_ml_enterprise_spec.json"
Require-Path "config\ai_framework_selection.json"
Require-Path "config\cost_optimization_policy.json"
Require-Path "config\model_providers.json"
Require-Path "config\context_policy.json"
Require-Path "config\roles.json"
Require-Path "config\agent_blueprint_contract.json"
Require-Path "config\agent_improvement_loop.json"
Require-Path "docs\radar\README.md"
Require-Path "docs\architecture\continual-learning.md"
Require-Path "rag\README.md"
Require-Path "vector_db\README.md"
Require-Path "playbooks\README.md"
Require-Path "prompts\README.md"
Require-Path "evals\quality_gates.yaml"
Require-Path "llm_ops\observability.yaml"
Require-Path "ml_systems\data_contract.yaml"
Require-Path "rag_pipelines\pipeline.yaml"
Require-Path "guardrails\policy.yaml"
Require-Path "docs\books\implementation_map.md"
Require-Path "scripts\diagnose_project.ps1"
Require-Path "scripts\context_filter.py"
Require-Path "scripts\market_radar.py"
Require-Path "scripts\synapse_lib\business_solution_analyzer.py"
Require-Path "scripts\synapse_lib\eval_service.py"
Require-Path "scripts\synapse_lib\peer_messaging_service.py"
Require-Path ".codex\config.toml"
Require-Path "scripts\codex_data_treatment_dialog.ps1"
Require-Path "scripts\import_project_file.ps1"
Require-Path "scripts\treat_dataset.py"
Require-Path "prompts\master_data_treatment.md"
Require-Path "prompts\codex_data_treatment_dialog.md"
Require-Path "config\data_treatment_policy.json"
Require-Path "config\workflows\synapse\new-ai-project.json"
Require-Path "config\workflows\synapse\rag-build.json"
Require-Path "config\workflows\synapse\ml-release.json"
Require-Path "config\rag_scalability_policy.json"
Require-Path "config\fine_tuning_policy.json"
Require-Path "config\harness_engineering_policy.json"
Require-Path "docs\specifications\scalable_rag_vector_db.md"
Require-Path "docs\specifications\fine_tuning.md"
Require-Path "docs\specifications\harness_engineering.md"
Require-Path "scripts\synapse_lib\vector_store.py"
Require-Path "scripts\synapse_lib\rag_retrieval.py"
Require-Path "scripts\synapse_lib\rag_scalability.py"
Require-Path "scripts\synapse_lib\fine_tuning_service.py"
Require-Path "scripts\synapse_lib\harness_service.py"
Require-Path "evals\retrieval_cases.jsonl"
Require-Path "evals\tool_workflow_cases.jsonl"
Require-Path "templates\rag\rag_pipeline.py"
Require-Path "templates\rag\vector_db_adapter.py"
Require-Path "config\workflows\synapse\agent-build.json"
Require-Path "config\solution_agents.json"
Require-Path "scripts\synapse_lib\solution_agents.py"
Require-Path "scripts\scaffold_solution_agents.py"
Require-Path "scripts\synapse_lib\business_transformation.py"
Require-Path "scripts\run_business_transformation.py"
Require-Path "evals\business_transformation_cases.jsonl"
Require-Path "templates\business\transformation_brief.json"
Require-Path "config\book_registry.json"
Require-Path "scripts\sync_book_registry.py"
Require-Path "config\agentic_architectural_patterns.json"
Require-Path "config\business_solution_catalog.json"
Require-Path "config\business_transformation.json"
Require-Path "config\llm_solution_factory_policy.json"
Require-Path "config\ml_foundations_policy.json"
Require-Path "config\voice_agent_quality_gates.json"
Require-Path "scripts\analyze_business_solution.py"
Require-Path "scripts\audit_harness.py"
Require-Path "scripts\prepare_fine_tuning_dataset.py"
Require-Path "scripts\run_evals.py"
Require-Path "scripts\synapse_peers_mcp.py"
Require-Path "scripts\synapse_lib\model_service.py"
Require-Path "scripts\synapse_lib\ai_framework_selector.py"
Require-Path "scripts\synapse_lib\text_utils.py"

python -m compileall scripts tests | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha na compilacao Python")
}

python -c "import json; from pathlib import Path; m=json.loads(Path('config/runtime_manifest.json').read_text(encoding='utf-8-sig')); assert 'swarm' not in m and 'agentic_mesh' not in m and 'generated_project_swarm_strategy' not in m; g=m['agent_governance']; assert g['enabled'] is True; assert g['governance_policy_file']=='config/harness_engineering_policy.json'; assert g['roles_file']=='config/roles.json'; assert g['agent_blueprint_contract_file']=='config/agent_blueprint_contract.json'; assert g['improvement_loop_file']=='config/agent_improvement_loop.json'; assert m['cost_optimization']['enabled'] is True; assert m['cost_optimization']['policy_file']=='config/cost_optimization_policy.json'; assert m['memory']['enabled'] is True; assert m['memory']['runtime_file']=='memory/project_memory.runtime.json'; assert 'required_agents' not in m['validation'] and 'specialist_agents' not in m['validation']; assert len(m['validation']['required_practice_paths'])>=14; c=m['continual_learning']; assert c['enabled'] is True; assert c['automatic_weight_updates'] is False; assert c['promotion_requires_evals_and_human_approval'] is True; print('runtime_manifest_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato do runtime manifest")
}

python -c "from pathlib import Path; import json; m=json.loads(Path('config/runtime_manifest.json').read_text(encoding='utf-8-sig')); missing=[p for p in m['validation']['required_practice_paths'] if not Path(p).exists()]; assert not missing, missing; print('practice_paths_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha na validacao dos artefatos inspirados nos livros")
}

python -c "import json; from pathlib import Path; spec=json.loads(Path('config/ai_ml_enterprise_spec.json').read_text(encoding='utf-8-sig')); e=spec['execution_policy']; assert e['data_treatment_required_for_all_universes'] is True; assert e['cost_aware_orchestration_required'] is True; assert not [k for k in e if 'agent_count' in k or 'swarm' in k or 'ruflo' in k], e; assert spec['multi_agent_systems']['default']=='single_agent_first'; assert spec['sdd']['required_outputs']; assert 'multi_query_retrieval' in spec['rag_advanced']['strategies']; assert 'drift_monitoring' in spec['ml_systems']['required_design_fields']; assert 'autogen' in spec['ai_framework_selection']['required_frameworks']; print('enterprise_ai_ml_spec_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato enterprise IA/ML")
}

python -c "from scripts.synapse_lib.ai_framework_selector import AiFrameworkSelector; s=AiFrameworkSelector(); ids=[f['id'] for f in s.list_frameworks()]; required=['langgraph','llamaindex','haystack','openai-agents-sdk','pydantic-ai','crewai','autogen','microsoft-agent-framework-semantic-kernel','dify','flowise','ragflow','r2r','mcp-sdks','swarms']; assert ids==required, ids; r=s.select('criar agentes com RAG, MCP, documentos e tool calling', 'hybrid'); assert r['active'] is True; assert 'mcp-sdks' in r['recommended_framework_ids']; assert r['rag_blueprint']['candidate_frameworks']; print('ai_framework_selection_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato de selecao de frameworks IA")
}

foreach ($WorkflowFile in Get-ChildItem config\workflows\synapse -Filter *.json) {
    python -m json.tool $WorkflowFile.FullName | Out-Null
    if ($LASTEXITCODE -ne 0) { $Errors.Add("JSON invalido: $($WorkflowFile.Name)") }
}

python -c "import json; from pathlib import Path; roles={r['id'] for r in json.loads(Path('config/roles.json').read_text(encoding='utf-8'))['roles']}; bad={w.name: [s.get('role') for s in json.loads(w.read_text(encoding='utf-8-sig'))['steps'] if s.get('role') not in roles] for w in Path('config/workflows/synapse').glob('*.json')}; bad={k: v for k, v in bad.items() if v}; assert not bad, bad; removed=['config/agent_fleets.json','config/agent_trust_framework.json','agents/definitions/enterprise_agents.yaml']; assert not [p for p in removed if Path(p).exists()], removed; print('workflow_roles_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Workflows devem usar apenas papeis de config/roles.json, sem swarm/fleets/trust framework")
}
python -c "import json; from pathlib import Path; load=lambda p: json.loads(Path(p).read_text(encoding='utf-8-sig')); cost=load('config/cost_optimization_policy.json'); assert 'ruflo' not in cost and 'activation_profiles' not in cost; assert not [n for n, p in cost['request_profiles'].items() if 'active_agent_limit' in p], cost['request_profiles']; ft=load('config/fine_tuning_policy.json'); assert ft['provider_rules']['automatic_weight_updates'] is False; assert ft['release_gates']['human_approval_required'] is True; h=load('config/harness_engineering_policy.json'); assert h['eval_harness']['reliability_gate_pass_hat_k_min']>0; assert h['governance']['autonomy_matrix']['requires_human_approval']; missing=[t for tech in load('config/ai_framework_selection.json')['technology_catalog'] for t in tech.get('templates', []) if not Path(t).exists()]; assert not missing, missing; print('ai_engineering_extensions_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha na coerencia de custo, fine-tuning, harness ou templates")
}

python scripts\scaffold_solution_agents.py --validate-only | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Blueprints de config/solution_agents.json violam o agent blueprint contract")
}

python scripts\run_business_transformation.py --cases evals\business_transformation_cases.jsonl | Out-Null
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Casos de transformacao empresarial (risco, autonomia, aprovacao) nao passaram")
}

python scripts\sync_book_registry.py --check | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Registro de livros fora de sincronia: rode python scripts/sync_book_registry.py")
}

python scripts\run_evals.py retrieval | Out-Null
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Gates de retrieval hibrido (evals/retrieval_cases.jsonl) nao passaram")
}

if ($Errors.Count -gt 0) {
    Write-Host "Validacao falhou:" -ForegroundColor Red
    $Errors | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "enterprise_stack_ok" -ForegroundColor Green
