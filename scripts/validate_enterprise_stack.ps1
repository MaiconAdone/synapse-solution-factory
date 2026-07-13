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
Require-Path "config\agent_trust_framework.json"
Require-Path "config\agent_fleets.json"
Require-Path "config\agent_blueprint_contract.json"
Require-Path "config\agent_improvement_loop.json"
Require-Path "docs\radar\README.md"
Require-Path "docs\architecture\agentic-mesh-governance.md"
Require-Path "docs\architecture\continual-learning.md"
Require-Path "agents\definitions\enterprise_agents.yaml"
Require-Path "backend\app\main.py"
Require-Path "frontend\app\page.tsx"
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
Require-Path "scripts\start_ruflo_swarm.ps1"
Require-Path "scripts\diagnose_project.ps1"
Require-Path "scripts\context_filter.py"
Require-Path "scripts\market_radar.py"
Require-Path "scripts\synapse_ollama_mcp.py"
Require-Path "backend\app\services\hybrid_llm_router.py"
Require-Path "backend\app\services\governed_swarm_execution.py"
Require-Path "backend\app\services\continual_learning_service.py"
Require-Path ".codex\config.toml"
Require-Path "scripts\test_local_llm.py"
Require-Path "scripts\codex_data_treatment_dialog.ps1"
Require-Path "scripts\import_project_file.ps1"
Require-Path "scripts\treat_dataset.py"
Require-Path "scripts\verify_codex_ruflo_integration.ps1"
Require-Path "prompts\master_data_treatment.md"
Require-Path "prompts\codex_data_treatment_dialog.md"
Require-Path "config\data_treatment_policy.json"
Require-Path "config\workflows\ruflo\new-ai-project.json"
Require-Path "config\workflows\ruflo\rag-build.json"
Require-Path "config\workflows\ruflo\ml-release.json"

$env:PYTHONPATH = "backend"
python -m compileall backend\app tests | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha na compilacao Python")
}

python -c "from app.repositories.runtime_manifest import load_runtime_manifest; m=load_runtime_manifest(); assert m['swarm']['topology']=='hierarchical-mesh'; assert m['swarm']['max_agents']==60; assert m['swarm']['core_agent_count']==15; assert m['swarm']['specialist_agent_count']==45; assert m['cost_optimization']['enabled'] is True; assert m['cost_optimization']['policy_file']=='config/cost_optimization_policy.json'; assert m['cost_optimization']['activate_all_60_requires_explicit_high_complexity'] is True; assert m['agentic_mesh']['enabled'] is True; assert m['agentic_mesh']['trust_layers']==7; assert m['agentic_mesh']['fleet_count']>=6; assert m['agentic_mesh']['agent_blueprint_contract_file']=='config/agent_blueprint_contract.json'; assert m['agentic_mesh']['improvement_loop_file']=='config/agent_improvement_loop.json'; assert m['agentic_mesh']['human_approval_required_for_all_60_agents'] is True; assert m['memory']['enabled'] is True; assert m['memory']['runtime_file']=='memory/project_memory.runtime.json'; assert len(m['validation']['required_agents'])==15; assert len(m['validation']['specialist_agents'])==45; assert len(m['validation']['required_practice_paths'])>=14; print('runtime_manifest_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato do runtime manifest")
}

python -c "from pathlib import Path; import json; m=json.loads(Path('config/runtime_manifest.json').read_text(encoding='utf-8-sig')); missing=[p for p in m['validation']['required_practice_paths'] if not Path(p).exists()]; assert not missing, missing; print('practice_paths_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha na validacao dos artefatos inspirados nos livros")
}

python -c "from app.services.enterprise_spec_service import EnterpriseSpecService; s=EnterpriseSpecService(); spec=s.spec(); assert spec['execution_policy']['ruflo_required_for_project_creation'] is True; assert spec['execution_policy']['ruflo_15_agents_required_for_all_universes'] is True; assert spec['execution_policy']['data_treatment_required_for_all_universes'] is True; assert spec['execution_policy']['parallel_agent_count']==15; assert spec['execution_policy']['max_agent_count']==60; assert spec['execution_policy']['specialist_agent_count']==45; assert spec['execution_policy']['cost_aware_orchestration_required'] is True; assert spec['execution_policy']['default_active_agent_count']==1; assert spec['execution_policy']['activate_all_60_requires_explicit_high_complexity'] is True; assert spec['sdd']['required_outputs']; assert 'multi_query_retrieval' in spec['rag_advanced']['strategies']; assert 'drift_monitoring' in spec['ml_systems']['required_design_fields']; assert 'autogen' in spec['ai_framework_selection']['required_frameworks']; assert s.validate_runtime_alignment()['aligned'] is True; print('enterprise_ai_ml_spec_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato enterprise IA/ML")
}

python -c "from app.services.ai_framework_selector import AiFrameworkSelector; s=AiFrameworkSelector(); ids=[f['id'] for f in s.list_frameworks()]; required=['langgraph','llamaindex','haystack','openai-agents-sdk','pydantic-ai','crewai','autogen','microsoft-agent-framework-semantic-kernel','dify','flowise','ragflow','r2r','mcp-sdks','swarms']; assert ids==required, ids; r=s.select('criar agentes com RAG, MCP, documentos e tool calling', 'hybrid'); assert r['active'] is True; assert 'mcp-sdks' in r['recommended_framework_ids']; assert r['rag_blueprint']['candidate_frameworks']; print('ai_framework_selection_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato de selecao de frameworks IA")
}

python -c "from app.services.cost_aware_router import CostAwareRouter; r=CostAwareRouter().route('criar projeto IA com RAG e baixo custo de tokens', 'ia'); assert r['max_available_agents']==60; assert r['active_agent_count'] < 60; assert r['token_controls']['prefer_prompt_cache'] is True; assert 'cost-optimizer' in r['specialist_agents']; print('cost_aware_router_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato de roteamento economico")
}

python -c "from app.services.agentic_mesh_governance import AgenticMeshGovernanceService; s=AgenticMeshGovernanceService(); v=s.validate(); assert v['valid'] is True, v; assert len(v['trust_layer_ids'])==7; assert 'project_factory_fleet' in v['fleet_ids']; assert s.fleet_for_request('criar novo projeto IA com RAG e MCP', 'ia')['selected_fleet']['id'] in {'project_factory_fleet','rag_fleet','mcp_fleet'}; print('agentic_mesh_governance_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato de agentic mesh governance")
}

python -c "from app.agents.catalog import AGENT_CATALOG; from app.repositories.runtime_manifest import load_runtime_manifest; m=load_runtime_manifest(); assert len(AGENT_CATALOG)==60; assert all('governed_llm_router' in a['tools'] for a in AGENT_CATALOG); assert m['local_llm']['all_60_agents_model_access']=='governed_on_demand'; assert m['local_llm']['ruflo_shared_memory_namespace']=='synapse-governed-execution'; print('governed_ruflo_ollama_bridge_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato da ponte governada Ruflo/Ollama")
}

python -c "from app.repositories.runtime_manifest import load_runtime_manifest; m=load_runtime_manifest(); c=m['continual_learning']; assert c['enabled'] is True; assert c['automatic_weight_updates'] is False; assert c['promotion_requires_evals_and_human_approval'] is True; print('continual_learning_governance_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato de aprendizagem continua governada")
}

python -c "from app.services.agent_blueprint_service import AgentBlueprintService; s=AgentBlueprintService(); v=s.validate_contracts(); assert v['valid'] is True, v; assert s.decide_architecture('corrigir uma funcao simples', 'ia')['mode']=='single_agent'; assert s.decide_architecture('criar RAG com MCP e seguranca', 'ia')['mode'] in {'multiagent','fleet'}; print('agent_blueprint_contract_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato de agent blueprint e improvement loop")
}

python -c "from app.services.ruflo_service import RufloService; C=type('C',(),{'call_tool':lambda self, tool_name, arguments=None: {'tool': tool_name, 'arguments': arguments}}); s=RufloService(client=C()); r=s.execute_workflow('rag-build', ['rag-engineering'], True); assert r['available'] is True; assert r['data']['tool']=='daa_workflow_execute'; print('ruflo_adapter_contract_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha no contrato do adaptador Ruflo")
}

python -m json.tool config\workflows\ruflo\new-ai-project.json | Out-Null
python -m json.tool config\workflows\ruflo\rag-build.json | Out-Null
python -m json.tool config\workflows\ruflo\ml-release.json | Out-Null
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Falha na validacao JSON dos workflows Ruflo")
}

python -c "import json; from pathlib import Path; w=json.loads(Path('config/workflows/ruflo/new-ai-project.json').read_text(encoding='utf-8-sig')); assert w['execution']['parallelAgentActivation'] is True; print('new_project_parallel_activation_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Workflow new-ai-project nao declara ativacao paralela de agentes")
}

python -c "import json, re; from pathlib import Path; m=json.loads(Path('config/runtime_manifest.json').read_text(encoding='utf-8-sig')); required=m['validation']['required_agents']; specialists=m['validation']['specialist_agents']; workflow=json.loads(Path('config/workflows/ruflo/new-ai-project.json').read_text(encoding='utf-8-sig')); groups=workflow['execution']['parallelGroups']; parallel=[agent for group in groups for agent in group]; steps={step['agent'] for step in workflow['steps']}; yaml_ids=re.findall(r'(?m)^\s*-\s+id:\s*([A-Za-z0-9_-]+)\s*$', Path('agents/definitions/enterprise_agents.yaml').read_text(encoding='utf-8-sig')); assert len(required)==15, required; assert len(specialists)==45, specialists; assert len(yaml_ids)==60 and len(set(yaml_ids))==60, yaml_ids; assert len(parallel)==15 and len(set(parallel))==15, parallel; assert set(parallel)==set(required), {'parallel': parallel, 'required': required}; assert set(required).issubset(steps), {'missing_step_agents': sorted(set(required)-steps)}; assert set(yaml_ids)==set(required+specialists), {'yaml_ids': yaml_ids, 'expected': required+specialists}; print('new_project_60_agent_contract_ok')" | Out-Host
if ($LASTEXITCODE -ne 0) {
    $Errors.Add("Workflow new-ai-project deve conter 15 core agents em paralelo e YAML deve conter 60 agentes")
}

if (Test-Path "frontend\package.json") {
    Push-Location frontend
    npm pkg get scripts.build | Out-Host
    if ($LASTEXITCODE -ne 0) {
        $Errors.Add("Falha ao validar package.json do frontend")
    }
    Pop-Location
}

if ($Errors.Count -gt 0) {
    Write-Host "Validacao falhou:" -ForegroundColor Red
    $Errors | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "enterprise_stack_ok" -ForegroundColor Green
