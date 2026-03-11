import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CandidateDocument } from '../entities/candidate-document.entity';
import { CandidateSummary } from '../entities/candidate-summary.entity';
import { SUMMARIZATION_PROVIDER } from '../llm/summarization-provider.interface';
import type { SummarizationProvider } from '../llm/summarization-provider.interface';
import { QueueService } from '../queue/queue.service';
import { SummaryGenerationWorkerService } from './summary-generation.worker';

describe('SummaryGenerationWorkerService', () => {
  let worker: SummaryGenerationWorkerService;
  let summaryRepository: { findOne: jest.Mock; save: jest.Mock };
  let documentRepository: { find: jest.Mock };
  let queueService: { takeNext: jest.Mock };
  let summarizationProvider: SummarizationProvider;

  const mockProvider: SummarizationProvider = {
    generateCandidateSummary: jest.fn().mockResolvedValue({
      score: 75,
      strengths: ['Strong communicator'],
      concerns: ['Limited experience'],
      summary: 'Solid candidate.',
      recommendedDecision: 'hold',
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    summaryRepository = { findOne: jest.fn(), save: jest.fn() };
    documentRepository = { find: jest.fn() };
    queueService = { takeNext: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SummaryGenerationWorkerService,
        { provide: QueueService, useValue: queueService },
        { provide: getRepositoryToken(CandidateSummary), useValue: summaryRepository },
        { provide: getRepositoryToken(CandidateDocument), useValue: documentRepository },
        { provide: SUMMARIZATION_PROVIDER, useValue: mockProvider },
      ],
    }).compile();

    worker = module.get<SummaryGenerationWorkerService>(SummaryGenerationWorkerService);
    summarizationProvider = module.get(SUMMARIZATION_PROVIDER);
  });

  it('processes a pending summary job and persists result', async () => {
    const summary = {
      id: 'sum-1',
      candidateId: 'cand-1',
      status: 'pending',
      score: null,
      strengths: null,
      concerns: null,
      summary: null,
      recommendedDecision: null,
      provider: null,
      promptVersion: null,
      errorMessage: null,
    };
    summaryRepository.findOne.mockResolvedValue(summary);
    summaryRepository.save.mockImplementation(async (s: CandidateSummary) => s);
    documentRepository.find.mockResolvedValue([
      { rawText: 'Resume text here' },
    ]);
    queueService.takeNext.mockReturnValueOnce({
      payload: { summaryId: 'sum-1' },
    }).mockReturnValueOnce(null);

    // Trigger one processing cycle (processNext is public for testing)
    await worker.processNext();

    expect(summarizationProvider.generateCandidateSummary).toHaveBeenCalledWith({
      candidateId: 'cand-1',
      documents: ['Resume text here'],
    });
    expect(summaryRepository.save).toHaveBeenCalled();
    const saved = summaryRepository.save.mock.calls[0][0];
    expect(saved.status).toBe('completed');
    expect(saved.score).toBe('75');
    expect(saved.recommendedDecision).toBe('hold');
  });

  it('sets status to failed when provider throws', async () => {
    (mockProvider.generateCandidateSummary as jest.Mock).mockRejectedValueOnce(
      new Error('API rate limit'),
    );
    const summary = {
      id: 'sum-2',
      candidateId: 'cand-2',
      status: 'pending',
      errorMessage: null,
    };
    summaryRepository.findOne.mockResolvedValue(summary);
    summaryRepository.save.mockImplementation(async (s: CandidateSummary) => s);
    documentRepository.find.mockResolvedValue([{ rawText: 'x' }]);
    queueService.takeNext.mockReturnValueOnce({
      payload: { summaryId: 'sum-2' },
    });

    await worker.processNext();

    expect(summaryRepository.save).toHaveBeenCalled();
    const saved = summaryRepository.save.mock.calls[0][0];
    expect(saved.status).toBe('failed');
    expect(saved.errorMessage).toContain('rate limit');
  });
});
