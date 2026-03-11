import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  CandidateSummaryInput,
  CandidateSummaryResult,
  RecommendedDecision,
} from './summarization-provider.interface';
import { SummarizationProvider } from './summarization-provider.interface';

const VALID_DECISIONS: RecommendedDecision[] = ['advance', 'hold', 'reject'];

function parseStructuredResult(raw: string): CandidateSummaryResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Summarization provider returned invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Summarization provider returned non-object');
  }
  const o = parsed as Record<string, unknown>;
  const score = typeof o.score === 'number' ? o.score : Number(o.score);
  if (Number.isNaN(score) || score < 0 || score > 100) {
    throw new Error('Invalid or missing score');
  }
  const strengths = Array.isArray(o.strengths)
    ? o.strengths.filter((s): s is string => typeof s === 'string')
    : [];
  const concerns = Array.isArray(o.concerns)
    ? o.concerns.filter((c): c is string => typeof c === 'string')
    : [];
  const summary = typeof o.summary === 'string' ? o.summary : '';
  const recommendedDecision =
    typeof o.recommendedDecision === 'string' &&
    VALID_DECISIONS.includes(o.recommendedDecision as RecommendedDecision)
      ? (o.recommendedDecision as RecommendedDecision)
      : 'hold';
  return {
    score,
    strengths,
    concerns,
    summary,
    recommendedDecision,
  };
}

@Injectable()
export class GeminiSummarizationProvider implements SummarizationProvider {
  constructor(private readonly configService: ConfigService) {}

  async generateCandidateSummary(
    input: CandidateSummaryInput,
  ): Promise<CandidateSummaryResult> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const documentText = input.documents.join('\n\n---\n\n');
    const systemPrompt = `You are a recruiter assistant. Given candidate document text, produce a structured candidate summary.
Respond with a single JSON object (no markdown, no code fence) with exactly these keys:
- score: number 0-100 (overall fit)
- strengths: array of strings
- concerns: array of strings
- summary: string (brief paragraph)
- recommendedDecision: one of "advance", "hold", "reject"`;

    const userPrompt = `Candidate ID: ${input.candidateId}\n\nDocuments:\n${documentText.slice(
      0,
      30000,
    )}`;

    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

    const body = {
      contents: [
        {
          parts: [
            {
              text: `${systemPrompt}\n\n${userPrompt}`,
            },
          ],
        },
      ],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    const json = (await response.json()) as any;

    if (!response.ok) {
      const message =
        json?.error?.message ??
        `Gemini API returned status ${response.status}`;
      throw new Error(message);
    }

    const text: string | undefined =
      json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text || typeof text !== 'string') {
      throw new Error('Summarization provider returned no text');
    }

    return parseStructuredResult(text);
  }
}
