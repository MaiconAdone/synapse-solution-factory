"use client";

import { useState } from "react";

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

type ActionState = {
  name: string;
  loading: boolean;
  result: unknown;
  error: string | null;
};

type CreationStep = "pedido" | "problema" | "pronto";

type AgentBriefingResponse = {
  agent: string;
  phase: string;
  message: string;
  llm_response: string;
  suggested_project_name: string;
  solution_focus: string;
  next_question: string;
  missing_questions: string[];
  ready_to_create: boolean;
  required_fields: string[];
  recommendations: string[];
  foundation_principles: string[];
  parallel_agents: string[];
  execution_plan: string[];
  token_strategy: string;
  ruflo: {
    source?: string;
    available?: boolean;
    tool?: string;
    parallel_default?: boolean;
    workflow?: string;
  };
};

type AgentMessage = {
  role: "usuario" | "ruflo";
  text: string;
};

const initialTrainingPayload = JSON.stringify(
  {
    model_name: "Revenue Baseline",
    feature_columns: ["leads", "price"],
    target_column: "revenue",
    dataset: [
      { leads: 1, price: 10, revenue: 20 },
      { leads: 2, price: 10, revenue: 30 },
      { leads: 3, price: 10, revenue: 40 },
    ],
  },
  null,
  2,
);

const initialDataTreatmentPayload = JSON.stringify(
  [
    { cliente_id: 1, receita: 100, segmento: "A" },
    { cliente_id: 2, receita: null, segmento: "B" },
    { cliente_id: 3, receita: 9999, segmento: "Raro" },
  ],
  null,
  2,
);

async function postSynapse(path: string, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
  }

  const response = await fetch(`/api/synapse${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail ?? data.error ?? `HTTP ${response.status}`);
  }
  return data;
}

function suggestProjectName(text: string) {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

  return normalized || "novo_projeto_ai_ml";
}

export function OpsConsole() {
  const [state, setState] = useState<ActionState>({
    name: "pronto",
    loading: false,
    result: null,
    error: null,
  });
  const [trainingPayload, setTrainingPayload] = useState(initialTrainingPayload);
  const [dataTreatmentPayload, setDataTreatmentPayload] = useState(initialDataTreatmentPayload);
  const [contextText, setContextText] = useState("");
  const [contextLimit, setContextLimit] = useState(12000);
  const [radarOffline, setRadarOffline] = useState(false);
  const [modelId, setModelId] = useState("");
  const [workflowId, setWorkflowId] = useState("rag-build");
  const [parallelWorkflow, setParallelWorkflow] = useState(true);
  const [aliasModelName, setAliasModelName] = useState("");
  const [aliasVersion, setAliasVersion] = useState("");
  const [alias, setAlias] = useState("candidate");
  const [projectName, setProjectName] = useState("");
  const [projectType, setProjectType] = useState("ML + IA (Hibrido)");
  const [activateRuflo, setActivateRuflo] = useState(true);
  const [creationStep, setCreationStep] = useState<CreationStep>("pedido");
  const [projectGoal, setProjectGoal] = useState("");
  const [businessProblem, setBusinessProblem] = useState("");
  const [solutionFocus, setSolutionFocus] = useState("ai-ml-agents");
  const [successMetric, setSuccessMetric] = useState("");
  const [availableSources, setAvailableSources] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [briefing, setBriefing] = useState<AgentBriefingResponse | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      role: "ruflo",
      text: "Descreva o que voce quer criar. Eu vou transformar isso em um projeto de ML/agentes de IA sem codigo, usando os playbooks base e o swarm Ruflo.",
    },
  ]);

  async function run(name: string, action: () => Promise<unknown>) {
    setState({ name, loading: true, result: null, error: null });
    try {
      const result = await action();
      setState({ name, loading: false, result, error: null });
    } catch (error) {
      setState({
        name,
        loading: false,
        result: null,
        error: error instanceof Error ? error.message : "erro desconhecido",
      });
    }
  }

  async function askRuflo(message: string, nextStep: CreationStep) {
    setState({ name: "consultar Ruflo", loading: true, result: null, error: null });
    try {
      const result = (await postSynapse("/projects/briefing", {
        message,
        project_goal: projectGoal,
        business_problem: businessProblem,
        solution_focus: solutionFocus,
        success_metric_or_acceptance_criteria: successMetric,
        available_data_or_knowledge_sources: availableSources,
        risk_level: riskLevel,
      })) as AgentBriefingResponse;

      setBriefing(result);
      setProjectName(projectName.trim() || result.suggested_project_name || suggestProjectName(projectGoal));
      setSolutionFocus(result.solution_focus);
      setCreationStep(result.ready_to_create ? "pronto" : nextStep);
      setAgentMessages((messages) => [
        ...messages,
        { role: "usuario", text: message },
        {
          role: "ruflo",
          text: [
            result.llm_response,
            "",
            result.missing_questions.length
              ? `Informacoes faltantes:\n${result.missing_questions.map((question) => `- ${question}`).join("\n")}`
              : `Proxima pergunta: ${result.next_question}`,
          ].join("\n"),
        },
      ]);
      setState({ name: "Ruflo respondeu", loading: false, result, error: null });
    } catch (error) {
      setState({
        name: "consultar Ruflo",
        loading: false,
        result: null,
        error: error instanceof Error ? error.message : "erro desconhecido",
      });
    }
  }

  return (
    <div className="ops-grid">
      <section className="panel ops-panel ops-dialog">
        <div className="ops-dialog-header">
          <h2>Dialogo no-code para ML e agentes de IA</h2>
          <span className="status">Ruflo paralelo / {creationStep}</span>
        </div>

        <div className="dialog-layout">
          <div className="agent-thread" aria-live="polite">
            {agentMessages.map((message, index) => (
              <div className={`agent-message ${message.role}`} key={`${message.role}-${index}`}>
                <strong>{message.role === "ruflo" ? "LLM / orchestration-manager" : "Voce"}</strong>
                <p>{message.text}</p>
              </div>
            ))}
          </div>

          <aside className="llm-response-panel">
            <strong>Resposta estruturada do LLM</strong>
            <p>{briefing?.llm_response ?? "A resposta consolidada dos agentes aparecera aqui depois do briefing."}</p>
            {briefing ? (
              <>
                {briefing.missing_questions.length ? (
                  <>
                    <span>Informacoes faltantes</span>
                    <ul>
                      {briefing.missing_questions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <span>Agentes paralelos</span>
                <ul>
                  {briefing.parallel_agents.map((agent) => (
                    <li key={agent}>{agent}</li>
                  ))}
                </ul>
                <span>Estrategia de tokens</span>
                <p>{briefing.token_strategy}</p>
              </>
            ) : null}
          </aside>
        </div>

        {creationStep === "pedido" ? (
          <>
            <label className="ops-field">
              <span>O que voce quer criar?</span>
              <textarea
                aria-label="Pergunta para criar projeto"
                className="ops-textarea"
                placeholder="Ex.: Crie um SaaS B2B2C com agentes de IA e modelos de ML para reduzir churn em uma operacao comercial."
                value={projectGoal}
                onChange={(event) => {
                  setProjectGoal(event.target.value);
                  if (!projectName.trim()) {
                    setProjectName(suggestProjectName(event.target.value));
                  }
                }}
              />
            </label>
            <div className="ops-actions">
              <button
                className="ops-button"
                type="button"
                onClick={() => askRuflo(projectGoal, "problema")}
                disabled={!projectGoal.trim() || state.loading}
              >
                Perguntar ao Ruflo
              </button>
            </div>
          </>
        ) : null}

        {creationStep !== "pedido" ? (
          <>
            <label className="ops-field">
              <span>Problema de negocio</span>
              <textarea
                aria-label="Problema de negocio"
                className="ops-textarea"
                placeholder="Qual decisao, processo ou resultado o ML/agente de IA precisa melhorar? Inclua metrica de sucesso, publico impactado e dados disponiveis."
                value={businessProblem}
                onChange={(event) => setBusinessProblem(event.target.value)}
              />
            </label>
            <label className="ops-field">
              <span>Metrica de sucesso ou criterio de aceite</span>
              <textarea
                aria-label="Metrica de sucesso ou criterio de aceite"
                className="ops-textarea"
                placeholder="Ex.: AUC acima de 0.80, reduzir tempo de atendimento em 30%, respostas com fonte citada e satisfacao acima de 80%."
                value={successMetric}
                onChange={(event) => setSuccessMetric(event.target.value)}
              />
            </label>
            <label className="ops-field">
              <span>Dados, documentos ou fontes disponiveis</span>
              <textarea
                aria-label="Dados documentos ou fontes disponiveis"
                className="ops-textarea"
                placeholder="Ex.: CSV de clientes, historico de vendas, PDFs de politicas internas, CRM, ERP, tickets ou base de conhecimento."
                value={availableSources}
                onChange={(event) => setAvailableSources(event.target.value)}
              />
            </label>
            <div className="ops-split">
              <label className="ops-field">
                <span>Nome do projeto</span>
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
              </label>
              <label className="ops-field">
                <span>Foco</span>
                <select value={solutionFocus} onChange={(event) => setSolutionFocus(event.target.value)}>
                  <option value="ai-ml-agents">IA + ML + agentes</option>
                  <option value="ml">Modelo de ML</option>
                  <option value="agents">Agentes de IA</option>
                  <option value="rag">RAG / busca semantica</option>
                  <option value="chatbots">Chatbolt / chatbot</option>
                </select>
              </label>
            </div>
            <label className="ops-field">
              <span>Tipo do projeto</span>
              <select value={projectType} onChange={(event) => setProjectType(event.target.value)}>
                <option value="ML">ML</option>
                <option value="IA">IA</option>
                <option value="ML + IA (Hibrido)">ML + IA (Hibrido)</option>
                <option value="Chatbolt">Chatbolt</option>
              </select>
            </label>
            <label className="ops-field">
              <span>Nivel de risco</span>
              <select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)}>
                <option value="">Selecione</option>
                <option value="baixo">Baixo</option>
                <option value="medio">Medio</option>
                <option value="alto">Alto</option>
                <option value="critico">Critico</option>
              </select>
            </label>
            <label className="ops-check">
              <input
                checked={activateRuflo}
                type="checkbox"
                onChange={(event) => setActivateRuflo(event.target.checked)}
              />
              <span>Ativar Ruflo com roteamento economico</span>
            </label>
            <div className="ops-actions">
              <button className="ops-button secondary" type="button" onClick={() => setCreationStep("pedido")}>
                Voltar
              </button>
              <button
                className="ops-button secondary"
                type="button"
                onClick={() => askRuflo(businessProblem, "problema")}
                disabled={
                  !businessProblem.trim() ||
                  !successMetric.trim() ||
                  !availableSources.trim() ||
                  !riskLevel.trim() ||
                  state.loading
                }
              >
                Enviar aos agentes
              </button>
              <button
                className="ops-button"
                type="button"
                onClick={() =>
                  run("criar projeto com LLM + Ruflo", () =>
                    postSynapse("/projects/create", {
                      name: projectName,
                      project_type: projectType,
                      activate_ruflo: activateRuflo,
                      project_goal: projectGoal,
                      business_problem: businessProblem,
                      solution_focus: solutionFocus,
                      success_metric_or_acceptance_criteria: successMetric,
                      available_data_or_knowledge_sources: availableSources,
                      risk_level: riskLevel,
                      require_business_problem: true,
                    }),
                  )
                }
                disabled={
                  !projectName.trim() ||
                  !businessProblem.trim() ||
                  !successMetric.trim() ||
                  !availableSources.trim() ||
                  !riskLevel.trim() ||
                  briefing?.ready_to_create !== true
                }
              >
                Criar projeto completo
              </button>
            </div>
            {briefing ? (
              <div className="agent-recommendations">
                <strong>Base dos livros e execucao dos agentes</strong>
                <ul>
                  {briefing.foundation_principles.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <strong>Plano de execucao</strong>
                <ul>
                  {briefing.execution_plan.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <strong>Recomendacoes dos agentes</strong>
                <ul>
                  {briefing.recommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="panel ops-panel">
        <h2>Treinar modelo</h2>
        <textarea
          aria-label="Payload de treino"
          className="ops-textarea"
          value={trainingPayload}
          onChange={(event) => setTrainingPayload(event.target.value)}
        />
        <button
          className="ops-button"
          type="button"
          onClick={() =>
            run("treinar modelo", async () => {
              const payload = JSON.parse(trainingPayload);
              const result = await postSynapse("/models/train", payload);
              if (typeof result.model_id === "string") {
                setModelId(result.model_id);
              }
              if (typeof result.mlflow?.registered_model_name === "string") {
                setAliasModelName(result.mlflow.registered_model_name);
              }
              return result;
            })
          }
        >
          Treinar
        </button>
      </section>

      <section className="panel ops-panel">
        <h2>Rodar avaliacoes</h2>
        <label className="ops-field">
          <span>ID do modelo</span>
          <input value={modelId} onChange={(event) => setModelId(event.target.value)} />
        </label>
        <div className="ops-actions">
          <button
            className="ops-button"
            type="button"
            onClick={() =>
              run("avaliacao ML", () =>
                postSynapse("/evals/ml", {
                  model_id: modelId || null,
                  cases_path: "evals/ml_cases.jsonl",
                }),
              )
            }
          >
            Rodar avaliacao ML
          </button>
          <button
            className="ops-button secondary"
            type="button"
            onClick={() =>
              run("avaliacao IA", () =>
                postSynapse("/evals/ai", {
                  cases_path: "evals/prompt_cases.jsonl",
                  eval_type: "prompt",
                }),
              )
            }
          >
            Rodar avaliacao IA
          </button>
        </div>
      </section>

      <section className="panel ops-panel">
        <h2>Tratar dados</h2>
        <textarea
          aria-label="Registros para tratamento"
          className="ops-textarea"
          value={dataTreatmentPayload}
          onChange={(event) => setDataTreatmentPayload(event.target.value)}
        />
        <button
          className="ops-button"
          type="button"
          onClick={() =>
            run("tratamento de dados", () =>
              postSynapse("/tools/data-treatment", {
                records: JSON.parse(dataTreatmentPayload),
                winsorize_outliers: false,
              }),
            )
          }
        >
          Tratar registros
        </button>
      </section>

      <section className="panel ops-panel">
        <h2>Filtrar contexto</h2>
        <textarea
          aria-label="Contexto para filtrar"
          className="ops-textarea"
          placeholder="Cole logs, codigo ou contexto extenso."
          value={contextText}
          onChange={(event) => setContextText(event.target.value)}
        />
        <label className="ops-field">
          <span>Limite de caracteres</span>
          <input
            min={200}
            max={100000}
            type="number"
            value={contextLimit}
            onChange={(event) => setContextLimit(Number(event.target.value))}
          />
        </label>
        <button
          className="ops-button"
          type="button"
          disabled={!contextText.trim()}
          onClick={() =>
            run("filtro de contexto", () =>
              postSynapse("/tools/context-filter", {
                text: contextText,
                max_chars: contextLimit,
              }),
            )
          }
        >
          Comprimir contexto
        </button>
      </section>

      <section className="panel ops-panel">
        <h2>Market radar</h2>
        <label className="ops-check">
          <input
            checked={radarOffline}
            type="checkbox"
            onChange={(event) => setRadarOffline(event.target.checked)}
          />
          <span>Usar sinais locais sem consultar fontes externas</span>
        </label>
        <button
          className="ops-button"
          type="button"
          onClick={() => run("market radar", () => postSynapse("/tools/market-radar", { offline: radarOffline }))}
        >
          Executar radar
        </button>
      </section>

      <section className="panel ops-panel">
        <h2>Executar workflow</h2>
        <label className="ops-field">
          <span>ID do workflow</span>
          <input value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} />
        </label>
        <label className="ops-check">
          <input
            checked={parallelWorkflow}
            type="checkbox"
            onChange={(event) => setParallelWorkflow(event.target.checked)}
          />
          <span>Execucao paralela</span>
        </label>
        <button
          className="ops-button"
          type="button"
          onClick={() =>
            run("executar workflow", () =>
              postSynapse(`/workflows/${workflowId}/execute`, {
                agent_ids: null,
                parallel_execution: parallelWorkflow,
              }),
            )
          }
        >
          Executar
        </button>
      </section>

      <section className="panel ops-panel">
        <h2>Promover modelo</h2>
        <label className="ops-field">
          <span>Modelo registrado</span>
          <input value={aliasModelName} onChange={(event) => setAliasModelName(event.target.value)} />
        </label>
        <label className="ops-field">
          <span>Versao</span>
          <input value={aliasVersion} onChange={(event) => setAliasVersion(event.target.value)} />
        </label>
        <label className="ops-field">
          <span>Alias</span>
          <select value={alias} onChange={(event) => setAlias(event.target.value)}>
            <option value="candidate">candidate</option>
            <option value="challenger">challenger</option>
            <option value="champion">champion</option>
            <option value="archived">archived</option>
          </select>
        </label>
        <button
          className="ops-button"
          type="button"
          onClick={() =>
            run("promover modelo", () =>
              postSynapse("/mlflow/models/alias", {
                model_name: aliasModelName,
                version: aliasVersion,
                alias,
              }),
            )
          }
        >
          Promover
        </button>
      </section>

      <section className="panel ops-result">
        <div className="ops-result-header">
          <h2>Resultado</h2>
          <span className="status">{state.loading ? "executando" : state.name}</span>
        </div>
        {state.error ? <p className="ops-error">{state.error}</p> : null}
        <pre>{JSON.stringify(state.result ?? { status: "pronto" }, null, 2)}</pre>
      </section>
    </div>
  );
}
