// aiClient.js - Centralized AI clients (Anthropic primary, OpenAI secondary)
import { getSecret } from 'wix-secrets-backend';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

let anthropic = null;
let openai = null;

export async function initAI() {
    if (!anthropic) {
        const apiKey = await getSecret('ANTHROPIC_API_KEY');
        if (apiKey) {
            anthropic = new Anthropic({ apiKey });
        }
    }
    if (!openai) {
        const openaiKey = await getSecret('OPENAI_API_KEY');
        if (openaiKey) {
            openai = new OpenAI({ apiKey: openaiKey });
        }
    }
}

export async function askClaude({ system, user, maxTokens = 1000, model = 'claude-3-5-haiku-latest' }) {
    await initAI();
    if (!anthropic) throw new Error('Anthropic client not initialized');
    const resp = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: system || undefined,
        messages: [
            { role: 'user', content: user }
        ]
    });
    const content = resp && resp.content && resp.content[0] && resp.content[0].type === 'text' ? resp.content[0].text : '';
    return content || '';
}

export async function askClaudeJSON(params) {
    const text = await askClaude(params);
    const match = text && text.match(/\{[\s\S]*\}/);
    if (match) {
        try { return JSON.parse(match[0]); } catch (_) { /* ignore */ }
    }
    return null;
}

export async function askOpenAIMini({ system, user, maxTokens = 800, model = 'gpt-4o-mini' }) {
    await initAI();
    if (!openai) throw new Error('OpenAI client not initialized');
    const resp = await openai.chat.completions.create({
        model,
        messages: [
            system ? { role: 'system', content: system } : null,
            { role: 'user', content: user }
        ].filter(Boolean),
        max_tokens: maxTokens
    });
    return resp.choices?.[0]?.message?.content || '';
}


