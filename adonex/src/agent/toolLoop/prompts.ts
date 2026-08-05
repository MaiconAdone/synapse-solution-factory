import type { ToolLoopTool } from "./types";

/**
 * Prefixa o system prompt ja montado pelo AgentOrchestrator (BASE_SYSTEM_PROMPT +
 * STATIC_POLICY_PROMPT + contexto Synapse + actionPrompt) com as instrucoes do
 * Tool Loop. Generaliza o padrao de buildRouterSystemPrompt (agent/routerAgent.ts)
 * para multiplas ferramentas e multiplos turnos.
 */
export function buildToolLoopSystemPrompt(base: string, tools: ToolLoopTool[]): string {
  const toolList = tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
  return [
    base,
    [
      "MODO TOOL LOOP: em vez de responder tudo de uma vez, escolha UMA ferramenta por turno e observe o resultado antes do proximo passo.",
      "Ferramentas disponiveis:",
      toolList,
      '- finish: encerra o loop. Formato: {"tool": "finish", "summary": string, "commands": string[]}.',
      "Regras:",
      "1. Leia o arquivo com read_file antes de editar com edit_file; nunca invente conteudo que voce nao leu.",
      "2. edit_file recebe UMA operacao cirurgica por chamada (replace/insert_before/insert_after/append/delete) com um anchor/expected exato do arquivo lido — nunca reescreva o arquivo inteiro.",
      "3. Use search_files ou list_files quando nao souber o caminho exato do arquivo.",
      "4. Use run_command apenas para validar (ex.: rodar testes), nunca para instalar dependencias sem necessidade clara.",
      "5. Chame finish assim que a mudanca estiver completa; nao repita passos ja feitos.",
      'Responda SOMENTE com um objeto JSON de um turno: {"tool": string, "thought"?: string, ...argumentos da ferramenta escolhida}. Sem prosa, sem cercas de codigo.'
    ].join("\n")
  ].join("\n\n");
}

export function buildToolLoopUserPrompt(task: string, transcript: string): string {
  return [
    `Tarefa: ${task}`,
    "",
    "Historico de passos ate agora:",
    transcript,
    "",
    "Qual e o proximo passo? Responda com o JSON de um unico turno."
  ].join("\n");
}
