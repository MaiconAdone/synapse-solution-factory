/**
 * Utilitarios puros para transformar a saida do modelo local em codigo aplicavel
 * na edicao inline (Cmd+K) e no autocomplete inline (ghost text).
 */

/**
 * Extrai o codigo de uma resposta do modelo. Se houver blocos cercados por
 * crases, retorna o maior bloco (o modelo costuma responder o codigo em um
 * unico bloco); caso contrario, devolve o texto limpo, sem prosa antes/depois.
 */
export function extractCodeBlock(text: string): string {
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    blocks.push(match[1]);
  }
  if (blocks.length) {
    return stripTrailingNewline(blocks.sort((a, b) => b.length - a.length)[0]);
  }
  return stripTrailingNewline(text.trim());
}

function stripTrailingNewline(value: string): string {
  return value.replace(/\n$/, "");
}

/**
 * Limpa uma sugestao de autocomplete FIM: remove cercas de codigo residuais,
 * tokens especiais de fill-in-middle e eco do prefixo quando o modelo repete o
 * inicio da linha ja digitada.
 */
export function cleanFimCompletion(raw: string, prefix: string): string {
  let text = raw;
  // Remove tokens especiais de FIM que alguns modelos vazam.
  text = text.replace(/<\|(?:fim_[a-z]+|endoftext|file_sep|repo_name)\|>/gi, "");
  text = text.replace(/<｜[^｜>]*｜>/g, "");
  // Remove cercas de codigo se o modelo embrulhar a sugestao.
  text = text.replace(/```[a-z0-9_-]*\n?/gi, "").replace(/```/g, "");
  // Evita duplicar a ultima "palavra" ja digitada quando o modelo a repete.
  const tail = prefix.match(/[A-Za-z0-9_$.]+$/)?.[0];
  if (tail && text.startsWith(tail)) {
    text = text.slice(tail.length);
  }
  return text;
}

/** Constroi o prompt FIM manual para modelos qwen2.5-coder / deepseek-coder. */
export function buildFimPrompt(
  prefix: string,
  suffix: string,
  style: "qwen" | "deepseek" = "qwen"
): string {
  if (style === "deepseek") {
    return `<｜fim▁begin｜>${prefix}<｜fim▁hole｜>${suffix}<｜fim▁end｜>`;
  }
  return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
}

/** Limita prefixo/sufixo por numero de caracteres, preservando o que esta perto do cursor. */
export function boundFimWindow(
  prefix: string,
  suffix: string,
  maxPrefix: number,
  maxSuffix: number
): { prefix: string; suffix: string } {
  return {
    prefix: prefix.length > maxPrefix ? prefix.slice(prefix.length - maxPrefix) : prefix,
    suffix: suffix.length > maxSuffix ? suffix.slice(0, maxSuffix) : suffix
  };
}
