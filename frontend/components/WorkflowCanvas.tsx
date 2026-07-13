"use client";

import {
  BarChart3,
  BookOpenText,
  Bot,
  Cable,
  ChartNoAxesCombined,
  ChartNetwork,
  ChevronDown,
  ChevronRight,
  FileUp,
  FolderOpen,
  GitBranch,
  GripVertical,
  HardDriveUpload,
  LineChart,
  ListChecks,
  MessagesSquare,
  MessageCircleQuestion,
  Network,
  Play,
  Rocket,
  Search,
  ShieldCheck,
  TableColumnsSplit,
  Trash2,
  Upload,
  Workflow as WorkflowIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { Workflow } from "@/lib/api";

type UniverseId = "ml" | "ia" | "hybrid" | "chatbolt";

type WorkItem = {
  id: string;
  title: string;
  universe: UniverseId;
  workflowId: string;
  fleet: string;
  icon: LucideIcon;
  steps: string[];
  supportsFileUpload?: boolean;
};

type WorkAction = {
  id: string;
  title: string;
  icon: LucideIcon;
};

type FlowNode = WorkItem & {
  instanceId: string;
  fileName?: string;
  fileSize?: number;
};

const universes: Array<{ id: UniverseId; label: string }> = [
  { id: "ml", label: "ML" },
  { id: "ia", label: "IA" },
  { id: "hybrid", label: "ML + IA" },
  { id: "chatbolt", label: "Chatbolt" },
];

const workItems: WorkItem[] = [
  {
    id: "ml-data-treatment",
    title: "Tratar dados",
    universe: "ml",
    workflowId: "ml-release",
    fleet: "ml_fleet",
    icon: FileUp,
    steps: ["ausentes", "duplicados", "outliers", "tipos", "contrato"],
  },
  {
    id: "ml-eda",
    title: "Explorar dados",
    universe: "ml",
    workflowId: "ml-release",
    fleet: "ml_fleet",
    icon: Search,
    steps: ["distribuicoes", "correlacoes", "segmentos", "leakage", "insights"],
  },
  {
    id: "ml-feature-selection",
    title: "Selecionar arquivo",
    universe: "ml",
    workflowId: "ml-release",
    fleet: "ml_fleet",
    icon: TableColumnsSplit,
    steps: ["features", "importancia", "colinearidade", "baseline", "contrato"],
    supportsFileUpload: true,
  },
  {
    id: "ml-regression-model",
    title: "Modelo de regressao",
    universe: "ml",
    workflowId: "ml-release",
    fleet: "ml_fleet",
    icon: LineChart,
    steps: ["target continuo", "split", "treino", "rmse", "validacao"],
  },
  {
    id: "ml-classification-model",
    title: "Modelo de classificacao",
    universe: "ml",
    workflowId: "ml-release",
    fleet: "ml_fleet",
    icon: BarChart3,
    steps: ["classes", "balanceamento", "treino", "auc", "matriz"],
  },
  {
    id: "ml-forecast-model",
    title: "Modelo de previsao temporal",
    universe: "ml",
    workflowId: "ml-release",
    fleet: "ml_fleet",
    icon: LineChart,
    steps: ["serie", "janelas", "sazonalidade", "forecast", "backtest"],
  },
  {
    id: "ml-data-release",
    title: "Preparar release de modelo",
    universe: "ml",
    workflowId: "ml-release",
    fleet: "ml_fleet",
    icon: ListChecks,
    steps: ["dados", "baseline", "avaliacao", "model card", "release"],
  },
  {
    id: "ml-monitoring",
    title: "Auditar drift e metricas",
    universe: "ml",
    workflowId: "ml-release",
    fleet: "ml_fleet",
    icon: ChartNetwork,
    steps: ["dataset", "drift", "metricas", "risco", "rollback"],
  },
  {
    id: "ia-agent-definition",
    title: "Definir agente",
    universe: "ia",
    workflowId: "rag-build",
    fleet: "project_factory_fleet",
    icon: Bot,
    steps: ["objetivo", "persona", "limites", "ferramentas", "sucesso"],
  },
  {
    id: "ia-system-prompt",
    title: "Criar prompt system",
    universe: "ia",
    workflowId: "rag-build",
    fleet: "mcp_fleet",
    icon: BookOpenText,
    steps: ["instrucoes", "exemplos", "formato", "politicas", "testes"],
  },
  {
    id: "ia-rag",
    title: "Construir base RAG",
    universe: "ia",
    workflowId: "rag-build",
    fleet: "rag_fleet",
    icon: FolderOpen,
    steps: ["ingestao", "chunks", "embeddings", "indice", "eval"],
  },
  {
    id: "ia-tools",
    title: "Configurar MCP/tools",
    universe: "ia",
    workflowId: "rag-build",
    fleet: "mcp_fleet",
    icon: Network,
    steps: ["tools", "schemas", "permissoes", "guardrails", "eval"],
  },
  {
    id: "ia-memory",
    title: "Criar memoria",
    universe: "ia",
    workflowId: "rag-build",
    fleet: "rag_fleet",
    icon: HardDriveUpload,
    steps: ["working", "episodic", "semantic", "retencao", "privacidade"],
  },
  {
    id: "ia-guardrails",
    title: "Aplicar guardrails",
    universe: "ia",
    workflowId: "rag-build",
    fleet: "security_fleet",
    icon: ShieldCheck,
    steps: ["politicas", "pii", "recusas", "fallback", "humano"],
  },
  {
    id: "ia-evaluation",
    title: "Avaliar respostas",
    universe: "ia",
    workflowId: "rag-build",
    fleet: "security_fleet",
    icon: ListChecks,
    steps: ["casos", "factualidade", "seguranca", "regressao", "latencia"],
  },
  {
    id: "ia-publish-agent",
    title: "Publicar agente",
    universe: "ia",
    workflowId: "business-transformation",
    fleet: "business_transformation_fleet",
    icon: Rocket,
    steps: ["checklist", "observabilidade", "rollback", "aprovacao", "monitoramento"],
  },
  {
    id: "hybrid-project",
    title: "Criar projeto completo",
    universe: "hybrid",
    workflowId: "new-ai-project",
    fleet: "project_factory_fleet",
    icon: GitBranch,
    steps: ["briefing", "dados", "agentes", "swarm", "validacao"],
  },
  {
    id: "hybrid-data-analysis",
    title: "Analisar dados",
    universe: "hybrid",
    workflowId: "ml-release",
    fleet: "ml_fleet",
    icon: ChartNoAxesCombined,
    steps: ["dataset", "insights", "features", "riscos", "prioridades"],
  },
  {
    id: "hybrid-model-training",
    title: "Treinar modelos",
    universe: "hybrid",
    workflowId: "ml-release",
    fleet: "ml_fleet",
    icon: LineChart,
    steps: ["baseline", "modelos", "metricas", "comparacao", "registro"],
  },
  {
    id: "hybrid-api-integration",
    title: "Integrar APIs",
    universe: "hybrid",
    workflowId: "rag-build",
    fleet: "mcp_fleet",
    icon: Cable,
    steps: ["contratos", "tools", "permissoes", "testes", "logs"],
  },
  {
    id: "hybrid-prediction-service",
    title: "Servico preditivo",
    universe: "hybrid",
    workflowId: "business-transformation",
    fleet: "business_transformation_fleet",
    icon: Rocket,
    steps: ["endpoint", "modelo", "agente", "monitoramento", "rollback"],
  },
  {
    id: "hybrid-experiments",
    title: "Gerir experimentos",
    universe: "hybrid",
    workflowId: "ml-release",
    fleet: "ml_fleet",
    icon: ListChecks,
    steps: ["hipoteses", "runs", "metricas", "comparacao", "decisao"],
  },
  {
    id: "hybrid-transformation",
    title: "Transformacao agentica",
    universe: "hybrid",
    workflowId: "business-transformation",
    fleet: "business_transformation_fleet",
    icon: ChartNetwork,
    steps: ["diagnostico", "processos", "oportunidades", "aprovacao", "impacto"],
  },
  {
    id: "chatbolt-design",
    title: "Projetar Chatbolt",
    universe: "chatbolt",
    workflowId: "new-ai-project",
    fleet: "project_factory_fleet",
    icon: MessagesSquare,
    steps: ["persona", "fontes", "memoria", "fallbacks", "qualidade"],
  },
  {
    id: "chatbolt-config",
    title: "Configurar chatbot",
    universe: "chatbolt",
    workflowId: "new-ai-project",
    fleet: "project_factory_fleet",
    icon: Bot,
    steps: ["persona", "tom", "politicas", "sessao", "fallback"],
  },
  {
    id: "chatbolt-channels",
    title: "Integrar canais",
    universe: "chatbolt",
    workflowId: "rag-build",
    fleet: "mcp_fleet",
    icon: Cable,
    steps: ["web", "whatsapp", "api", "permissoes", "logs"],
  },
  {
    id: "chatbolt-feedback",
    title: "Coletar feedback",
    universe: "chatbolt",
    workflowId: "business-transformation",
    fleet: "business_transformation_fleet",
    icon: MessageCircleQuestion,
    steps: ["avaliacao", "motivos", "rotulos", "fila", "melhoria"],
  },
  {
    id: "chatbolt-intents",
    title: "Gerir intents",
    universe: "chatbolt",
    workflowId: "rag-build",
    fleet: "rag_fleet",
    icon: GitBranch,
    steps: ["intencoes", "entidades", "rotas", "exemplos", "testes"],
  },
  {
    id: "chatbolt-monitoring",
    title: "Monitorar conversas",
    universe: "chatbolt",
    workflowId: "business-transformation",
    fleet: "business_transformation_fleet",
    icon: ChartNetwork,
    steps: ["latencia", "fallbacks", "satisfacao", "riscos", "acoes"],
  },
  {
    id: "chatbolt-rag",
    title: "Publicar chatbot com RAG",
    universe: "chatbolt",
    workflowId: "rag-build",
    fleet: "rag_fleet",
    icon: Upload,
    steps: ["documentos", "citacoes", "sessao", "seguranca", "evals"],
  },
];

const actionMenus: Record<string, WorkAction[]> = {
  "ml-data-treatment": [
    { id: "missing", title: "Ausentes", icon: FileUp },
    { id: "duplicates", title: "Duplicados", icon: TableColumnsSplit },
    { id: "outliers", title: "Outliers", icon: ChartNetwork },
    { id: "types", title: "Tipos", icon: ListChecks },
  ],
  "ml-eda": [
    { id: "profile", title: "Perfil", icon: Search },
    { id: "distribution", title: "Distribuicoes", icon: ChartNoAxesCombined },
    { id: "correlation", title: "Correlacoes", icon: ChartNetwork },
    { id: "leakage", title: "Leakage", icon: ShieldCheck },
  ],
  "ml-feature-selection": [
    { id: "load-file", title: "Carregar CSV", icon: Upload },
    { id: "target", title: "Definir target", icon: TableColumnsSplit },
    { id: "features", title: "Features", icon: ListChecks },
    { id: "importance", title: "Importancia", icon: BarChart3 },
  ],
  "ml-regression-model": [
    { id: "linear", title: "Linear", icon: LineChart },
    { id: "tree", title: "Arvore", icon: GitBranch },
    { id: "forest", title: "Random forest", icon: ChartNetwork },
    { id: "metrics", title: "RMSE MAE", icon: BarChart3 },
  ],
  "ml-classification-model": [
    { id: "logistic", title: "Logistica", icon: BarChart3 },
    { id: "tree", title: "Arvore", icon: GitBranch },
    { id: "forest", title: "Random forest", icon: ChartNetwork },
    { id: "matrix", title: "Matriz", icon: TableColumnsSplit },
  ],
  "ml-forecast-model": [
    { id: "window", title: "Janelas", icon: LineChart },
    { id: "seasonality", title: "Sazonalidade", icon: ChartNoAxesCombined },
    { id: "backtest", title: "Backtest", icon: ListChecks },
    { id: "forecast", title: "Forecast", icon: Rocket },
  ],
  "ml-data-release": [
    { id: "model-card", title: "Model card", icon: BookOpenText },
    { id: "evals", title: "Evals", icon: ListChecks },
    { id: "approval", title: "Aprovacao", icon: ShieldCheck },
    { id: "release", title: "Release", icon: Rocket },
  ],
  "ml-monitoring": [
    { id: "drift", title: "Drift", icon: ChartNetwork },
    { id: "latency", title: "Latencia", icon: BarChart3 },
    { id: "quality", title: "Qualidade", icon: ListChecks },
    { id: "rollback", title: "Rollback", icon: GitBranch },
  ],
  "ia-agent-definition": [
    { id: "objective", title: "Objetivo", icon: Rocket },
    { id: "persona", title: "Persona", icon: Bot },
    { id: "limits", title: "Limites", icon: ShieldCheck },
    { id: "success", title: "Sucesso", icon: ListChecks },
  ],
  "ia-system-prompt": [
    { id: "instructions", title: "Instrucoes", icon: BookOpenText },
    { id: "examples", title: "Exemplos", icon: MessagesSquare },
    { id: "format", title: "Formato", icon: TableColumnsSplit },
    { id: "regression", title: "Regressao", icon: ListChecks },
  ],
  "ia-rag": [
    { id: "sources", title: "Fontes", icon: FolderOpen },
    { id: "chunks", title: "Chunks", icon: TableColumnsSplit },
    { id: "index", title: "Indice", icon: HardDriveUpload },
    { id: "citations", title: "Citacoes", icon: BookOpenText },
  ],
  "ia-tools": [
    { id: "schemas", title: "Schemas", icon: TableColumnsSplit },
    { id: "permissions", title: "Permissoes", icon: ShieldCheck },
    { id: "dry-run", title: "Dry-run", icon: Play },
    { id: "logs", title: "Logs", icon: ChartNetwork },
  ],
  "ia-memory": [
    { id: "working", title: "Working", icon: HardDriveUpload },
    { id: "episodic", title: "Episodic", icon: MessagesSquare },
    { id: "semantic", title: "Semantic", icon: Network },
    { id: "privacy", title: "Privacidade", icon: ShieldCheck },
  ],
  "ia-guardrails": [
    { id: "policy", title: "Politicas", icon: ShieldCheck },
    { id: "pii", title: "PII", icon: ListChecks },
    { id: "fallback", title: "Fallback", icon: MessageCircleQuestion },
    { id: "human", title: "Humano", icon: Bot },
  ],
  "ia-evaluation": [
    { id: "cases", title: "Casos", icon: ListChecks },
    { id: "faithfulness", title: "Factualidade", icon: BookOpenText },
    { id: "safety", title: "Seguranca", icon: ShieldCheck },
    { id: "cost", title: "Custo", icon: BarChart3 },
  ],
  "ia-publish-agent": [
    { id: "checklist", title: "Checklist", icon: ListChecks },
    { id: "observability", title: "Observabilidade", icon: ChartNetwork },
    { id: "approval", title: "Aprovacao", icon: ShieldCheck },
    { id: "deploy", title: "Deploy", icon: Rocket },
  ],
  "hybrid-project": [
    { id: "briefing", title: "Briefing", icon: BookOpenText },
    { id: "factory", title: "Factory", icon: GitBranch },
    { id: "agents", title: "Agentes", icon: Bot },
    { id: "validation", title: "Validacao", icon: ListChecks },
  ],
  "hybrid-data-analysis": [
    { id: "profile", title: "Perfil", icon: Search },
    { id: "features", title: "Features", icon: TableColumnsSplit },
    { id: "risk", title: "Risco", icon: ShieldCheck },
    { id: "priority", title: "Prioridade", icon: BarChart3 },
  ],
  "hybrid-model-training": [
    { id: "baseline", title: "Baseline", icon: LineChart },
    { id: "compare", title: "Comparar", icon: BarChart3 },
    { id: "registry", title: "Registro", icon: HardDriveUpload },
    { id: "promote", title: "Promover", icon: Rocket },
  ],
  "hybrid-api-integration": [
    { id: "contracts", title: "Contratos", icon: BookOpenText },
    { id: "tools", title: "Tools", icon: Network },
    { id: "auth", title: "Auth", icon: ShieldCheck },
    { id: "logs", title: "Logs", icon: ChartNetwork },
  ],
  "hybrid-prediction-service": [
    { id: "endpoint", title: "Endpoint", icon: Cable },
    { id: "model", title: "Modelo", icon: LineChart },
    { id: "agent", title: "Agente", icon: Bot },
    { id: "rollback", title: "Rollback", icon: GitBranch },
  ],
  "hybrid-experiments": [
    { id: "hypothesis", title: "Hipotese", icon: BookOpenText },
    { id: "runs", title: "Runs", icon: ListChecks },
    { id: "metrics", title: "Metricas", icon: BarChart3 },
    { id: "decision", title: "Decisao", icon: ShieldCheck },
  ],
  "hybrid-transformation": [
    { id: "diagnosis", title: "Diagnostico", icon: Search },
    { id: "process", title: "Processos", icon: GitBranch },
    { id: "impact", title: "Impacto", icon: BarChart3 },
    { id: "approval", title: "Aprovacao", icon: ShieldCheck },
  ],
  "chatbolt-design": [
    { id: "persona", title: "Persona", icon: Bot },
    { id: "tone", title: "Tom", icon: MessagesSquare },
    { id: "fallback", title: "Fallback", icon: MessageCircleQuestion },
    { id: "quality", title: "Qualidade", icon: ListChecks },
  ],
  "chatbolt-config": [
    { id: "session", title: "Sessao", icon: HardDriveUpload },
    { id: "policy", title: "Politicas", icon: ShieldCheck },
    { id: "memory", title: "Memoria", icon: HardDriveUpload },
    { id: "handoff", title: "Handoff", icon: Network },
  ],
  "chatbolt-channels": [
    { id: "web", title: "Web", icon: Cable },
    { id: "whatsapp", title: "WhatsApp", icon: MessagesSquare },
    { id: "api", title: "API", icon: Network },
    { id: "permissions", title: "Permissoes", icon: ShieldCheck },
  ],
  "chatbolt-feedback": [
    { id: "rating", title: "Avaliacao", icon: MessageCircleQuestion },
    { id: "labels", title: "Rotulos", icon: TableColumnsSplit },
    { id: "queue", title: "Fila", icon: ListChecks },
    { id: "improve", title: "Melhoria", icon: Rocket },
  ],
  "chatbolt-intents": [
    { id: "intents", title: "Intents", icon: GitBranch },
    { id: "entities", title: "Entidades", icon: TableColumnsSplit },
    { id: "routes", title: "Rotas", icon: Network },
    { id: "tests", title: "Testes", icon: ListChecks },
  ],
  "chatbolt-monitoring": [
    { id: "latency", title: "Latencia", icon: BarChart3 },
    { id: "fallbacks", title: "Fallbacks", icon: MessageCircleQuestion },
    { id: "satisfaction", title: "Satisfacao", icon: MessagesSquare },
    { id: "risk", title: "Risco", icon: ShieldCheck },
  ],
  "chatbolt-rag": [
    { id: "docs", title: "Documentos", icon: Upload },
    { id: "citations", title: "Citacoes", icon: BookOpenText },
    { id: "sessions", title: "Sessoes", icon: MessagesSquare },
    { id: "evals", title: "Evals", icon: ListChecks },
  ],
};

let flowNodeCounter = 0;

function createFlowNode(item: WorkItem): FlowNode {
  flowNodeCounter += 1;
  return {
    ...item,
    instanceId: `${item.id}-${Date.now()}-${flowNodeCounter}`,
  };
}

function createActionNode(parent: WorkItem, action: WorkAction): FlowNode {
  return createFlowNode({
    ...parent,
    id: `${parent.id}-${action.id}`,
    title: action.title,
    icon: action.icon,
    steps: [action.title, ...parent.steps],
    supportsFileUpload: parent.supportsFileUpload,
  });
}

async function executeWorkflow(workflowId: string, parallelExecution: boolean) {
  const response = await fetch(`/api/synapse/workflows/${workflowId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_ids: null,
      parallel_execution: parallelExecution,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail ?? data.error ?? `HTTP ${response.status}`);
  }
  return data;
}

function itemKey(item: FlowNode) {
  return item.instanceId;
}

export function WorkflowCanvas({ workflows }: { workflows: Workflow[] }) {
  const [universe, setUniverse] = useState<UniverseId>("ml");
  const [sequence, setSequence] = useState<FlowNode[]>([createFlowNode(workItems.find((item) => item.id === "ml-data-treatment")!)]);
  const [parallelExecution, setParallelExecution] = useState(true);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [draggedSequenceIndex, setDraggedSequenceIndex] = useState<number | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({
    "ml-data-treatment": true,
  });

  const workflowIds = useMemo(() => new Set(workflows.map((workflow) => workflow.id)), [workflows]);
  const visibleItems = workItems.filter((item) => item.universe === universe);
  const allVisibleExpanded = visibleItems.every((item) => expandedItems[item.id]);
  const executableSequence = sequence.filter((item) => workflowIds.has(item.workflowId));
  const selectedWorkflow = executableSequence[0]?.workflowId ?? sequence[0]?.workflowId;

  function addItem(id: string) {
    const item = workItems.find((candidate) => candidate.id === id);
    if (item) {
      setSequence((current) => [...current, createFlowNode(item)]);
    }
  }

  function addAction(parentId: string, actionId: string) {
    const parent = workItems.find((candidate) => candidate.id === parentId);
    const action = actionMenus[parentId]?.find((candidate) => candidate.id === actionId);
    if (parent && action) {
      setSequence((current) => [...current, createActionNode(parent, action)]);
    }
  }

  function addMenuPayload(payload: string) {
    const [parentId, actionId] = payload.split("::");
    if (parentId && actionId) {
      addAction(parentId, actionId);
      return;
    }
    addItem(payload);
  }

  function toggleExpanded(id: string) {
    setExpandedItems((current) => ({ ...current, [id]: !current[id] }));
  }

  function toggleAllVisible() {
    setExpandedItems((current) => {
      const next = { ...current };
      for (const item of visibleItems) {
        next[item.id] = !allVisibleExpanded;
      }
      return next;
    });
  }

  function updateNodeFile(instanceId: string, file: File | null) {
    setSequence((current) =>
      current.map((item) =>
        item.instanceId === instanceId
          ? { ...item, fileName: file?.name, fileSize: file?.size }
          : item,
      ),
    );
  }

  function moveSequenceItem(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) {
      return;
    }
    setSequence((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  async function runMountedFlow() {
    if (executableSequence.length === 0) {
      return;
    }
    setIsExecuting(true);
    try {
      for (const item of executableSequence) {
        await executeWorkflow(item.workflowId, parallelExecution);
      }
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <div className="workflow-workbench">
      <section className="panel workflow-toolbar">
        <div className="segmented-control" aria-label="Universo do trabalho">
          {universes.map((item) => (
            <button
              className={item.id === universe ? "active" : ""}
              key={item.id}
              type="button"
              onClick={() => setUniverse(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="ops-check">
          <input
            checked={parallelExecution}
            type="checkbox"
            onChange={(event) => setParallelExecution(event.target.checked)}
          />
          <span>Execucao paralela</span>
        </label>
      </section>

      <section className="workflow-board">
        <div className="panel workflow-library">
          <div className="workflow-section-header">
            <div className="workflow-title-row">
              <h2>Trabalhos</h2>
              <button className="workflow-expand-all" type="button" onClick={toggleAllVisible}>
                {allVisibleExpanded ? "Recolher tudo" : "Expandir tudo"}
              </button>
            </div>
            <span className="status">{universes.find((item) => item.id === universe)?.label}</span>
          </div>
          <div className="workflow-card-list">
            {visibleItems.map((item) => {
              const actions = actionMenus[item.id] ?? [];
              const isExpanded = Boolean(expandedItems[item.id]);
              return (
                <article className="workflow-menu-item" key={item.id}>
                  <button
                    aria-label={`${isExpanded ? "Recolher" : "Expandir"} ${item.title}`}
                    className="workflow-expand-button"
                    type="button"
                    onClick={() => toggleExpanded(item.id)}
                  >
                    {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <button
                    className="workflow-card"
                    draggable
                    type="button"
                    onClick={() => addItem(item.id)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", item.id);
                      setDraggedItemId(item.id);
                    }}
                    onDragEnd={() => setDraggedItemId(null)}
                  >
                    <span className="work-icon" aria-hidden="true">
                      <item.icon size={17} />
                    </span>
                    <strong>{item.title}</strong>
                    <span className="drag-handle icon-drag-handle" aria-hidden="true">
                      <GripVertical size={15} />
                    </span>
                  </button>
                  {isExpanded ? (
                    <div className="workflow-action-grid">
                      {actions.map((action) => (
                        <button
                          className="workflow-action"
                          draggable
                          key={action.id}
                          type="button"
                          onClick={() => addAction(item.id, action.id)}
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/plain", `${item.id}::${action.id}`);
                            setDraggedItemId(`${item.id}::${action.id}`);
                          }}
                          onDragEnd={() => setDraggedItemId(null)}
                        >
                          <span className="work-icon action-icon" aria-hidden="true">
                            <action.icon size={15} />
                          </span>
                          <strong>{action.title}</strong>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <div
          className={`panel workflow-sequence ${draggedItemId ? "receiving" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const droppedId = event.dataTransfer.getData("text/plain");
            if (draggedSequenceIndex !== null) {
              setDraggedSequenceIndex(null);
              return;
            }
            addMenuPayload(droppedId);
            setDraggedItemId(null);
          }}
        >
          <div className="workflow-section-header">
            <h2>Fluxo montado</h2>
            <span className="status">{isExecuting ? "executando" : selectedWorkflow ?? "sem workflow"}</span>
          </div>
          <div className="workflow-lane">
            {sequence.map((item, index) => (
              <article
                className={`workflow-step ${item.fileName ? "has-file" : ""}`}
                draggable
                key={itemKey(item)}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", item.id);
                  setDraggedSequenceIndex(index);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedSequenceIndex !== null) {
                    moveSequenceItem(draggedSequenceIndex, index);
                    setDraggedSequenceIndex(null);
                  }
                }}
                onDragEnd={() => setDraggedSequenceIndex(null)}
              >
                <span className="work-icon sequence-icon" aria-hidden="true">
                  <item.icon size={18} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                </div>
                {item.id === "ml-feature-selection" ? (
                  <label
                    className="node-file-picker"
                    title="Carregar arquivo de variaveis"
                    onClick={(event) => event.stopPropagation()}
                    onDragStart={(event) => event.preventDefault()}
                  >
                    <Upload size={14} />
                    <span>{item.fileName ?? "Carregar arquivo"}</span>
                    <input
                      accept=".csv,.xlsx,.xls,.json,.jsonl,.parquet"
                      type="file"
                      onChange={(event) => updateNodeFile(item.instanceId, event.target.files?.[0] ?? null)}
                    />
                  </label>
                ) : null}
                <button
                  aria-label={`Remover ${item.title}`}
                  className="workflow-icon-button"
                  type="button"
                  onClick={() => setSequence((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
            {sequence.length === 0 ? (
              <div className="workflow-empty">
                <WorkflowIcon size={24} />
                <span>Nenhum trabalho selecionado</span>
              </div>
            ) : null}
          </div>
          <div className="ops-actions">
            <button className="ops-button" disabled={executableSequence.length === 0 || isExecuting} type="button" onClick={runMountedFlow}>
              <Play size={16} />
              Executar fluxo
            </button>
            <button className="ops-button secondary" type="button" onClick={() => setSequence([])}>
              Limpar
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
