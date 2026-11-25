// Platform settings stored in D1 (table `settings`). The AI key is stored encrypted and never sent to a browser.
import { seal, unseal } from './util.js';

/** Free-tier AI providers the admin can choose. `kind` decides which API format is used. */
export const PROVIDERS = {
  groq: {
    label: 'Groq',
    kind: 'openai',
    base: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
  },
  gemini: {
    label: 'Google Gemini',
    kind: 'openai',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash-lite',
    models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
  }
};

export async function loadSettings(env) {
  const rows = await env.DB.prepare('SELECT k, v FROM settings').all();
  const raw = Object.fromEntries(rows.results.map((r) => [r.k, r.v]));
  const defaultProvider = PROVIDERS[env.AI_PROVIDER] ? env.AI_PROVIDER : 'groq';
  const provider = PROVIDERS[raw.ai_provider] ? raw.ai_provider : defaultProvider;
  const fallbackProvider = Object.hasOwn(raw, 'ai_fallback_provider')
    ? PROVIDERS[raw.ai_fallback_provider] && raw.ai_fallback_provider !== provider
      ? raw.ai_fallback_provider
      : ''
    : provider === 'groq'
      ? 'gemini'
      : 'groq';
  return {
    provider,
    fallbackProvider,
    fallbackModel:
      raw.ai_fallback_model ||
      (fallbackProvider && PROVIDERS[fallbackProvider] ? PROVIDERS[fallbackProvider].model : ''),
    model: raw.ai_model || PROVIDERS[provider].model,
    baseUrl: raw.ai_base_url || '',
    keyBlob: raw.ai_key || '',
    legacyKeyProvider: raw.ai_provider || '',
    geminiKeyBlob: raw.ai_gemini_key || '',
    providerKeyBlobs: Object.fromEntries(
      Object.entries(raw)
        .filter(([key]) => key.startsWith('ai_key_'))
        .map(([key, value]) => [key.slice('ai_key_'.length), value])
    ),
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

/** The API key to use: the encrypted provider key or its server-side environment secret. */
export async function resolveKey(env, settings) {
  const providerKeyBlob = settings.providerKeyBlobs?.[settings.provider] || '';
  const keyBlob =
    providerKeyBlob ||
    (settings.provider === 'gemini' && settings.geminiKeyBlob ? settings.geminiKeyBlob : '') ||
    (settings.legacyKeyProvider === settings.provider ? settings.keyBlob : '');
  if (keyBlob) {
    try {
      return await unseal(env, keyBlob);
    } catch {
      return '';
    }
  }
  if (settings.provider === 'gemini') return env.GEMINI_API_KEY || '';
  if (settings.provider === 'groq') return env.GROQ_API_KEY || '';
  return '';
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

export async function storeProviderKey(env, provider, plain) {
  await saveSetting(env, 'ai_key_' + provider, await seal(env, plain));
}

export const keyHint = (plain) => (plain ? '••••' + plain.slice(-4) : '');
