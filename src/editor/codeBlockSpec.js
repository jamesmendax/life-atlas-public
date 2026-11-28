import { createCodeBlockSpec } from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";

const languageIds = new Map();
for (const [id, language] of Object.entries(codeBlockOptions.supportedLanguages)) {
  languageIds.set(id.toLowerCase(), id);
  for (const alias of language.aliases || []) languageIds.set(alias.toLowerCase(), id);
}

export function normalizeCodeBlockLanguage(language) {
  return languageIds.get(String(language || "text").trim().toLowerCase()) || "text";
}

const baseSpec = createCodeBlockSpec({ ...codeBlockOptions, defaultLanguage: "text" });

export const lifeAtlasCodeBlockSpec = {
  ...baseSpec,
  implementation: {
    ...baseSpec.implementation,
    meta: {
      ...baseSpec.implementation.meta,
      highlight: (block) => normalizeCodeBlockLanguage(block.props.language),
    },
    render: (block, editor) => baseSpec.implementation.render({
      ...block,
      props: { ...block.props, language: normalizeCodeBlockLanguage(block.props.language) },
    }, editor),
  },
};
