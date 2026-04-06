/**
 * TurboQuant Context Compression Plugin for OpenClaw
 *
 * Correct implementation — uses the before_prompt_build hook which runs
 * before every inference call and receives the full messages array.
 * This is the supported hook for modifying context before it hits the LLM.
 */

"use strict";

const DEFAULT_CONFIG = {
  enabled: true,
  keepRecentTurns: 6,
  compressionRatio: 0.25,
  minTurnsBeforeCompression: 10,
};

function getConfig(api) {
  return { ...DEFAULT_CONFIG, ...(api?.config?.plugins?.entries?.turboquant?.config ?? {}) };
}

// ─── Extractive compression ───────────────────────────────────────────────────

function scoreSentences(text) {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
  if (sentences.length <= 2) return sentences.map((s, i) => ({ s, i, score: 1 }));
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return sentences.map((s, i) => {
    const sw = s.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const tf = sw.reduce((sum, w) => sum + (freq[w] || 0), 0) / (sw.length || 1);
    return { s, score: tf * (i === 0 || i === sentences.length - 1 ? 2 : 1), i };
  });
}

function compressText(text, ratio) {
  if (!text || text.length < 120) return text;
  const target = Math.max(40, Math.ceil(text.length * ratio));
  const scored = scoreSentences(text).sort((a, b) => b.score - a.score);
  const picked = [];
  let len = 0;
  for (const item of scored) {
    if (len >= target && picked.length >= 1) break;
    picked.push(item);
    len += item.s.length;
  }
  picked.sort((a, b) => a.i - b.i);
  return `[~${Math.round(ratio * 100)}%] ${picked.map(p => p.s.trim()).join(' ')}`;
}

function compressContent(content, ratio) {
  if (typeof content === 'string') return compressText(content, ratio);
  if (Array.isArray(content)) return content.map(b => b.type === 'text' ? { ...b, text: compressText(b.text || '', ratio) } : b);
  return content;
}

function countTokensApprox(msgs) {
  let n = 0;
  for (const m of msgs) {
    const t = typeof m.content === 'string' ? m.content
      : Array.isArray(m.content) ? m.content.filter(b => b.type === 'text').map(b => b.text).join('') : '';
    n += Math.ceil(t.length / 4);
  }
  return n;
}

function applyCompression(messages, config, logger) {
  const { keepRecentTurns, compressionRatio, minTurnsBeforeCompression } = config;
  const sys = messages.filter(m => m.role === 'system');
  const conv = messages.filter(m => m.role !== 'system');
  if (conv.length < minTurnsBeforeCompression) return messages;
  const hotStart = Math.max(0, conv.length - keepRecentTurns);
  const cold = conv.slice(0, hotStart);
  const hot = conv.slice(hotStart);
  if (!cold.length) return messages;
  const before = countTokensApprox(messages);
  const compressed = cold.map(m => ({ ...m, content: compressContent(m.content, compressionRatio) }));
  const result = [...sys, ...compressed, ...hot];
  const after = countTokensApprox(result);
  const saved = before - after;
  if (saved > 20) {
    logger.info(`[turboquant] ${conv.length} turns → compressed ${cold.length} cold: ~${before}→~${after} tokens (saved ~${saved}, ${Math.round(saved/before*100)}%)`);
  }
  return result;
}

// ─── Plugin entry ─────────────────────────────────────────────────────────────

module.exports = function register(api) {
  const config = getConfig(api);

  if (!config.enabled) {
    api.logger.info('[turboquant] Disabled');
    return;
  }

  api.logger.info(
    `[turboquant] Loaded — hot=${config.keepRecentTurns} turns, cold→${Math.round(config.compressionRatio*100)}%, triggers@${config.minTurnsBeforeCompression}+`
  );

  // before_prompt_build fires before every inference, receives messages + prompt
  // Returns { messages } to replace the message array sent to the LLM
  api.registerHook('before_prompt_build', (event, ctx) => {
    try {
      const messages = event?.messages;
      if (!Array.isArray(messages)) return undefined;
      const conv = messages.filter(m => m.role !== 'system');
      if (conv.length < config.minTurnsBeforeCompression) return undefined;
      const compressed = applyCompression(messages, config, api.logger);
      if (compressed === messages) return undefined;
      return { messages: compressed };
    } catch (err) {
      api.logger.error(`[turboquant] before_prompt_build error: ${err.message}`);
      return undefined;
    }
  });

  // Also hook before_agent_start as a fallback (legacy path used by some sessions)
  api.registerHook('before_agent_start', (event, ctx) => {
    try {
      const messages = event?.messages;
      if (!Array.isArray(messages)) return undefined;
      const conv = messages.filter(m => m.role !== 'system');
      if (conv.length < config.minTurnsBeforeCompression) return undefined;
      const compressed = applyCompression(messages, config, api.logger);
      if (compressed === messages) return undefined;
      return { messages: compressed };
    } catch (err) {
      api.logger.error(`[turboquant] before_agent_start error: ${err.message}`);
      return undefined;
    }
  });
};
