import type { AgentAction, AgentMode, WorkspaceSnapshot } from "../llm/types";

export interface CompiledPrompt {
  originalPrompt: string;
  optimizedPrompt: string;
  systemAddendum: string;
  responseContract: string;
  maxOutputTokens?: number;
}

export function compilePrompt(
  prompt: string,
  action: AgentAction,
  mode: AgentMode,
  snapshot: WorkspaceSnapshot,
  options: { enabled: boolean }
): CompiledPrompt {
  if (!options.enabled) {
    return {
      originalPrompt: prompt,
      optimizedPrompt: prompt,
      systemAddendum: "Prompt compiler disabled.",
      responseContract: "Use the user's original prompt."
    };
  }

  const intent = inferIntent(prompt, action);
  const responseContract = responseContractFor(intent, action);
  const projectContext = [
    `Projeto Synapse detectado: ${snapshot.synapseDetected ? "sim" : "nao"}`,
    `Confianca Synapse: ${Math.round(snapshot.synapseConfidence * 100)}%`,
    `Stack inferida: ${snapshot.stack.slice(0, 12).join(", ") || "nao inferida"}`,
    `Sinais Synapse: ${snapshot.synapseSignals.slice(0, 12).join(", ") || "nenhum"}`,
    `Modo solicitado: ${mode}`,
    `Acao roteada: ${action}`
  ].join("\n");
  const selectedFiles = snapshot.relevantFiles
    .slice(0, 8)
    .map((file) => `- ${file.path} [score=${file.score}; ${file.reasons.join(", ")}]`)
    .join("\n");
  const codeIntelligence = formatCodeIntelligence(snapshot);

  const optimizedPrompt = [
    "PROMPT OTIMIZADO PELO ADONEX PROMPT COMPILER",
    "",
    "Papel:",
    roleFor(intent, snapshot.synapseDetected),
    "",
    "Objetivo do usuario:",
    prompt.trim(),
    "",
    "Intencao classificada:",
    intent,
    "",
    "Contexto operacional:",
    projectContext,
    "",
    "Arquivos relevantes:",
    selectedFiles || "- Nenhum arquivo relevante selecionado.",
    "",
    "Inteligencia de codigo:",
    codeIntelligence,
    "",
    // Politicas estaticas vivem em STATIC_POLICY_PROMPT (system prompt) para
    // preservar o prefix cache do Ollama; aqui fica apenas conteudo dinamico.
    "Contrato de resposta:",
    responseContract
  ].join("\n");

  return {
    originalPrompt: prompt,
    optimizedPrompt,
    systemAddendum: [
      "PROMPT ENGINEERING ACTIVE.",
      "The user prompt was compiled deterministically before model execution.",
      "Follow the optimized prompt, response contract, safety rules, and cost policy.",
      "Do not mention internal prompt compilation unless the user asks."
    ].join("\n"),
    responseContract,
    maxOutputTokens: maxOutputFor(intent, action)
  };
}

function formatCodeIntelligence(snapshot: WorkspaceSnapshot): string {
  const intel = snapshot.codeIntelligence;
  if (!intel) return "- Nao calculada.";
  const dependencies = intel.dependencyHints
    .slice(0, 5)
    .map((item) =>
      [
        `- ${item.path}`,
        item.imports.length ? `  imports: ${item.imports.slice(0, 6).join(", ")}` : "",
        item.exports.length ? `  exports: ${item.exports.slice(0, 6).join(", ")}` : "",
        item.declared.length ? `  declara: ${item.declared.slice(0, 6).join(", ")}` : ""
      ].filter(Boolean).join("\n")
    )
    .join("\n");
  return [
    `- Tipo de tarefa: ${intel.taskKind}`,
    `- Risco: ${intel.riskLevel}`,
    `- Perfil local sugerido: ${intel.modelProfile}`,
    `- Agentes sugeridos: ${intel.suggestedAgents.join(", ") || "nenhum"}`,
    `- Testes relacionados: ${intel.relatedTests.slice(0, 8).join(", ") || "nao encontrados"}`,
    "- Mapa rapido:",
    dependencies || "  - Sem simbolos relevantes detectados.",
    "- Notas:",
    ...intel.notes.map((note) => `  - ${note}`)
  ].join("\n");
}

export function inferIntent(prompt: string, action: AgentAction): string {
  const text = stripAccents(prompt.toLowerCase());
  if (action === "implement" || /\b(implemente|adicione|crie|altere|ajuste|evolua|melhore|edite|programe|codifique|modifique|refatore|corrija)\b/.test(text)) {
    return "implementacao-governada";
  }
  if (action === "review" || /\b(revise|review|analise codigo|seguranca|risco)\b/.test(text)) {
    return "revisao-tecnica";
  }
  if (action === "test" || /\b(teste|validacao|validar|build|pytest|npm run check)\b/.test(text)) {
    return "validacao";
  }
  if (action === "synapse_agent" || /\b(agente|agent|multiagente|ruflo)\b/.test(text)) {
    return "design-de-agente";
  }
  if (action === "synapse_mcp" || /\b(mcp|tool|ferramenta|function calling)\b/.test(text)) {
    return "design-mcp";
  }
  if (/\b(rag|retrieval|embedding|vetor|chunk|rerank|graph)\b/.test(text)) {
    return "arquitetura-rag";
  }
  if (/\bsynapse\b/.test(text) && /\b(modelo|modelos|model|models|ollama|llm|qwen|deepseek|embedding)\b/.test(text)) {
    return "inventario-de-modelos";
  }
  if (/\b(ml|machine learning|modelo|treino|dataset|feature|drift|mlflow)\b/.test(text)) {
    return "arquitetura-ml";
  }
  if (/\b(executiva|executivo|completa|estrategica|estrategico|negocio|produto)\b/.test(text)) {
    return "explicacao-executiva";
  }
  if (action === "plan" || /\b(plano|planeje|arquitetura|roadmap)\b/.test(text)) {
    return "planejamento-tecnico";
  }
  return "resposta-tecnica";
}

function roleFor(intent: string, synapseDetected: boolean): string {
  if (!synapseDetected) {
    return "Atue como engenheiro senior de software e IA, usando somente o contexto fornecido.";
  }
  const roles: Record<string, string> = {
    "implementacao-governada": "Atue como engenheiro senior do Synapse responsavel por especificacao, patch seguro, testes e validacao.",
    "revisao-tecnica": "Atue como revisor senior do Synapse, priorizando bugs, seguranca, custo, arquitetura e testes ausentes.",
    validacao: "Atue como engenheiro de qualidade do Synapse, focado em comandos minimos, evidencias e diagnostico.",
    "design-de-agente": "Atue como arquiteto multiagente do Synapse, definindo objetivo, ferramentas, memoria, contexto, limites e sucesso.",
    "design-mcp": "Atue como arquiteto MCP do Synapse, definindo schema, permissoes, timeouts, logs, fallback e testes.",
    "arquitetura-rag": "Atue como arquiteto RAG do Synapse, cobrindo ingestao, chunking, embeddings, retrieval, rerank, citacao e avaliacao.",
    "arquitetura-ml": "Atue como arquiteto ML do Synapse, cobrindo dados, features, baseline, treino, MLflow, avaliacao, drift e release.",
    "inventario-de-modelos": "Atue como engenheiro de plataforma local-first do Synapse, listando modelos, perfis, usos, rotas e limites sem generalizar.",
    "explicacao-executiva": "Atue como CTO/engenheiro executivo do Synapse, explicando valor de negocio, arquitetura, operacao, riscos e proximos passos.",
    "planejamento-tecnico": "Atue como arquiteto senior do Synapse, transformando a demanda em plano tecnico priorizado.",
    "resposta-tecnica": "Atue como engenheiro senior do Synapse, dando resposta tecnica objetiva e acionavel."
  };
  return roles[intent] ?? roles["resposta-tecnica"];
}

function responseContractFor(intent: string, action: AgentAction): string {
  if (["implement", "fix", "synapse_agent", "synapse_mcp"].includes(action)) {
    return [
      "Retorne somente JSON valido quando a acao exigir patch.",
      "Inclua summary, operations, changes e commands.",
      "Prefira operations incrementais com anchors/expected unicos para preservar edicoes simultaneas.",
      "Use changes com conteudo completo apenas para arquivo novo ou quando uma operacao incremental nao for segura.",
      "Se nao houver mudanca segura, retorne changes vazio e explique no summary."
    ].join("\n");
  }
  if (intent === "explicacao-executiva") {
    return [
      "Entregue uma explicacao executiva completa, nao superficial.",
      "Cubra: proposta de valor, arquitetura, operacao, governanca, baixo custo, riscos, indicadores e proximos passos.",
      "Use secoes curtas com bullets objetivos.",
      "Nao limite a resposta a uma frase."
    ].join("\n");
  }
  if (intent === "revisao-tecnica") {
    return "Comece pelos achados em ordem de severidade, cite arquivos quando possivel, depois riscos, testes e recomendacao.";
  }
  if (intent === "planejamento-tecnico") {
    return "Entregue objetivo, arquitetura proposta, arquivos provaveis, etapas, testes, riscos e criterio de aceite.";
  }
  if (intent === "inventario-de-modelos") {
    return "Liste os modelos por perfil/uso, informe provider, rota local/cloud, quando cada um e usado, e cite que cloud exige pedido explicito e aprovacao.";
  }
  return "Responda com conclusao direta, contexto minimo, recomendacao pratica, riscos e proximo passo.";
}

function maxOutputFor(intent: string, action: AgentAction): number | undefined {
  if (intent === "explicacao-executiva") return 700;
  if (intent === "inventario-de-modelos") return 900;
  if (action === "chat") return 220;
  if (action === "explain") return 320;
  return undefined;
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
