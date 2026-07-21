/**
 * Parser puro de mencoes @ no chat do AdoneX. Suporta mencoes especiais
 * (@selection, @editor, @file) e mencoes de caminho de arquivo do workspace.
 * A resolucao em disco fica no painel; aqui so classificamos os tokens.
 */
export const SPECIAL_MENTIONS = ["selection", "editor", "file"] as const;
export type SpecialMention = (typeof SPECIAL_MENTIONS)[number];

export interface ParsedMentions {
  specials: SpecialMention[];
  paths: string[];
}

const MENTION_PATTERN = /(?:^|\s)@([A-Za-z0-9_./\\-]+)/g;

export function parseMentions(text: string): ParsedMentions {
  const specials = new Set<SpecialMention>();
  const paths = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = MENTION_PATTERN.exec(text)) !== null) {
    const token = match[1].replace(/[.,;:)\]]+$/, "");
    if (!token) continue;
    if ((SPECIAL_MENTIONS as readonly string[]).includes(token.toLowerCase())) {
      specials.add(token.toLowerCase() as SpecialMention);
    } else if (/[./\\]/.test(token) || /\.[A-Za-z0-9]+$/.test(token)) {
      // So tratamos como arquivo quando parece um caminho (tem barra ou extensao).
      paths.add(token.replace(/\\/g, "/"));
    }
  }
  return { specials: [...specials], paths: [...paths] };
}

export function hasMentions(text: string): boolean {
  const parsed = parseMentions(text);
  return parsed.specials.length > 0 || parsed.paths.length > 0;
}
