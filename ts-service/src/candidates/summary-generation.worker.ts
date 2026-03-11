import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CandidateDocument } from '../entities/candidate-document.entity';
import { CandidateSummary } from '../entities/candidate-summary.entity';
import { SUMMARIZATION_PROVIDER } from '../llm/summarization-provider.interface';
import type { SummarizationProvider } from '../llm/summarization-provider.interface';
import {
  SUMMARY_GENERATION_JOB_NAME,
  SummaryGenerationJobPayload,
} from '../queue/queue.types';
import { QueueService } from '../queue/queue.service';

const PROMPT_VERSION = 'v1';
const POLL_INTERVAL_MS = 2000;

@Injectable()
export class SummaryGenerationWorkerService implements OnModuleInit, OnModuleDestroy {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly queueService: QueueService,
    @InjectRepository(CandidateSummary)
    private readonly summaryRepository: Repository<CandidateSummary>,
    @InjectRepository(CandidateDocument)
    private readonly documentRepository: Repository<CandidateDocument>,
    @Inject(SUMMARIZATION_PROVIDER)
    private readonly summarizationProvider: SummarizationProvider,
  ) {}

  onModuleInit(): void {
    this.intervalId = setInterval(() => this.processNext(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Process one job from the queue. Public for testing.
   */
  async processNext(): Promise<void> {
    const job = this.queueService.takeNext<SummaryGenerationJobPayload>(
      SUMMARY_GENERATION_JOB_NAME,
    );
    if (!job) return;

    const { summaryId } = job.payload;
    const summary = await this.summaryRepository.findOne({
      where: { id: summaryId },
    });

    if (!summary || summary.status !== 'pending') {
      return;
    }

    try {
      const documents = await this.documentRepository.find({
        where: { candidateId: summary.candidateId },
        order: { uploadedAt: 'ASC' },
      });
      const documentsText = documents.map((d) => d.rawText);

      const result = await this.summarizationProvider.generateCandidateSummary({
        candidateId: summary.candidateId,
        documents: documentsText,
      });

      summary.status = 'completed';
      summary.score = String(result.score);
      summary.strengths = result.strengths;
      summary.concerns = result.concerns;
      summary.summary = result.summary;
      summary.recommendedDecision = result.recommendedDecision;
      summary.provider = 'gemini';
      summary.promptVersion = PROMPT_VERSION;
      summary.errorMessage = null;
      await this.summaryRepository.save(summary);
    } catch (err) {
      summary.status = 'failed';
      summary.errorMessage = err instanceof Error ? err.message : String(err);
      await this.summaryRepository.save(summary);
    }
  }
}
