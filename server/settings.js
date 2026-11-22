// Platform settings stored in D1 (table `settings`). The AI key is stored encrypted and never sent to a browser.
import { seal, unseal } from './util.js';

/** AI providers the admin can choose. `kind` decides which API format is used. */
export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    base: 'https://api.anthropic.com',
    model: 'claude-sonnet-5-5',
    models: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    base: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o']
  },
  groq: {
    label: 'Groq',
    kind: 'openai',
    base: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
  },
  openrouter: {
    label: 'OpenRouter',
    kind: 'openai',
    base: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.3-70b-instruct']
  },
  nvidia: {
    label: 'NVIDIA Build',
    kind: 'openai',
    base: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.3-70b-instruct',
    models: ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-70b-instruct']
  },
  together: {
    label: 'Together AI',
    kind: 'openai',
    base: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo']
  },
  custom: { label: 'Custom (OpenAI-compatible)', kind: 'openai', base: '', model: '', models: [] }
};

export async function loadSettings(env) {
  const rows = await env.DB.prepare('SELECT k, v FROM settings').all();
  const raw = Object.fromEntries(rows.results.map((r) => [r.k, r.v]));
  const defaultProvider = PROVIDERS[env.AI_PROVIDER] ? env.AI_PROVIDER : 'groq';
  const provider = PROVIDERS[raw.ai_provider] ? raw.ai_provider : defaultProvider;
  return {
    provider,
    model: raw.ai_model || (provider === 'anthropic' && env.AI_MODEL) || PROVIDERS[provider].model,
    baseUrl: raw.ai_base_url || '',
    keyBlob: raw.ai_key || '',
    dailyLimit: Number(raw.ai_daily_limit) || Number(env.AI_DAILY_LIMIT) || 60,
    aiEnabled: raw.ai_enabled !== '0',
    signupsOpen: raw.signups_open !== '0'
  };
}

export async function saveSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')
    .bind(key, String(value))
    .run();
}

/** The API key to use: the one saved in the admin panel, or the ANTHROPIC_API_KEY secret as a fallback. */
export async function resolveKey(env, settings) {
  if (settings.keyBlob) {
    try {
      return await unseal(env, settings.keyBlob);
    } catch {
      return '';
    }
  }
  return settings.provider === 'anthropic' ? env.ANTHROPIC_API_KEY || '' : '';
}

export const aiReady = async (env, settings) =>
  settings.aiEnabled && !!(await resolveKey(env, settings)) && !!effectiveBase(settings);

export function effectiveBase(settings) {
  return (settings.baseUrl || PROVIDERS[settings.provider].base || '').replace(/\/+$/, '');
}

/** Accept https URLs, or http only for localhost (development). */
export function validBaseUrl(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))
    );
  } catch {
    return false;
  }
}

export async function storeKey(env, plain) {
  await saveSetting(env, 'ai_key', await seal(env, plain));
}

export const keyHint = (plain) => (plain ? '••••' + plain.slice(-4) : '');
