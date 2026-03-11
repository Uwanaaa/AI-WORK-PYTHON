import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuthUser } from '../auth/auth.types';
import { CandidateDocument } from '../entities/candidate-document.entity';
import { CandidateSummary } from '../entities/candidate-summary.entity';
import { SampleCandidate } from '../entities/sample-candidate.entity';
import { QueueService } from '../queue/queue.service';
import { CreateCandidateDocumentDto } from './dto/create-candidate-document.dto';
import { CandidatesService } from './candidates.service';

describe('CandidatesService', () => {
  let service: CandidatesService;

  const user: AuthUser = { userId: 'user-1', workspaceId: 'workspace-1' };

  const candidateRepository = {
    findOne: jest.fn(),
  };

  const documentRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const summaryRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const queueService = {
    enqueue: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidatesService,
        { provide: getRepositoryToken(SampleCandidate), useValue: candidateRepository },
        { provide: getRepositoryToken(CandidateDocument), useValue: documentRepository },
        { provide: getRepositoryToken(CandidateSummary), useValue: summaryRepository },
        { provide: QueueService, useValue: queueService },
      ],
    }).compile();

    service = module.get<CandidatesService>(CandidatesService);
  });

  describe('ensureCandidateInWorkspace', () => {
    it('returns candidate when in same workspace', async () => {
      const candidate = { id: 'cand-1', workspaceId: 'workspace-1' };
      candidateRepository.findOne.mockResolvedValue(candidate);

      const result = await service.ensureCandidateInWorkspace(
        'cand-1',
        'workspace-1',
      );
      expect(result).toBe(candidate);
    });

    it('throws NotFoundException when candidate missing', async () => {
      candidateRepository.findOne.mockResolvedValue(null);

      await expect(
        service.ensureCandidateInWorkspace('cand-1', 'workspace-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when candidate in other workspace', async () => {
      candidateRepository.findOne.mockResolvedValue({
        id: 'cand-1',
        workspaceId: 'other-workspace',
      });

      await expect(
        service.ensureCandidateInWorkspace('cand-1', 'workspace-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createDocument', () => {
    it('creates document with generated storageKey when not provided', async () => {
      candidateRepository.findOne.mockResolvedValue({
        id: 'cand-1',
        workspaceId: user.workspaceId,
      });
      documentRepository.create.mockImplementation((x: unknown) => x);
      documentRepository.save.mockImplementation(async (x: unknown) => x);

      const dto: CreateCandidateDocumentDto = {
        documentType: 'resume',
        fileName: 'resume.txt',
        rawText: 'Hello world',
      };

      const result = await service.createDocument(user, 'cand-1', dto);

      expect(documentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateId: 'cand-1',
          documentType: 'resume',
          fileName: 'resume.txt',
          rawText: 'Hello world',
          storageKey: expect.stringContaining('workspace-1'),
        }),
      );
      expect(documentRepository.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('requestSummaryGeneration', () => {
    it('creates pending summary and enqueues job', async () => {
      candidateRepository.findOne.mockResolvedValue({
        id: 'cand-1',
        workspaceId: user.workspaceId,
      });
      summaryRepository.create.mockImplementation((x: unknown) => x);
      summaryRepository.save.mockImplementation(async (x: unknown) => x);
      queueService.enqueue.mockReturnValue({ id: 'job-1' });

      const result = await service.requestSummaryGeneration(user, 'cand-1');

      expect(summaryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateId: 'cand-1',
          status: 'pending',
        }),
      );
      expect(summaryRepository.save).toHaveBeenCalled();
      expect(queueService.enqueue).toHaveBeenCalledWith(
        'generate-candidate-summary',
        expect.objectContaining({ summaryId: expect.any(String) }),
      );
      expect(result.status).toBe('pending');
      expect(result.summaryId).toBeDefined();
    });
  });

  describe('listSummaries', () => {
    it('returns summaries for candidate in workspace', async () => {
      candidateRepository.findOne.mockResolvedValue({
        id: 'cand-1',
        workspaceId: user.workspaceId,
      });
      summaryRepository.find.mockResolvedValue([{ id: 'sum-1', status: 'completed' }]);

      const result = await service.listSummaries(user, 'cand-1');

      expect(summaryRepository.find).toHaveBeenCalledWith({
        where: { candidateId: 'cand-1' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sum-1');
    });
  });

  describe('getSummary', () => {
    it('returns summary when found and in workspace', async () => {
      candidateRepository.findOne.mockResolvedValue({
        id: 'cand-1',
        workspaceId: user.workspaceId,
      });
      summaryRepository.findOne.mockResolvedValue({
        id: 'sum-1',
        candidateId: 'cand-1',
        status: 'completed',
      });

      const result = await service.getSummary(user, 'cand-1', 'sum-1');

      expect(result.id).toBe('sum-1');
      expect(result.status).toBe('completed');
    });

    it('throws NotFoundException when summary not found', async () => {
      candidateRepository.findOne.mockResolvedValue({
        id: 'cand-1',
        workspaceId: user.workspaceId,
      });
      summaryRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getSummary(user, 'cand-1', 'sum-missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
