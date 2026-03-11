import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuthUser } from '../auth/auth.types';
import { CandidateDocument, createCandidateDocumentId } from '../entities/candidate-document.entity';
import {
  CandidateSummary,
  createCandidateSummaryId,
} from '../entities/candidate-summary.entity';
import { SampleCandidate } from '../entities/sample-candidate.entity';
import { CreateCandidateDocumentDto } from './dto/create-candidate-document.dto';
import {
  SUMMARY_GENERATION_JOB_NAME,
  SummaryGenerationJobPayload,
} from '../queue/queue.types';
import { QueueService } from '../queue/queue.service';
@Injectable()
export class CandidatesService {
  constructor(
    @InjectRepository(SampleCandidate)
    private readonly candidateRepository: Repository<SampleCandidate>,
    @InjectRepository(CandidateDocument)
    private readonly documentRepository: Repository<CandidateDocument>,
    @InjectRepository(CandidateSummary)
    private readonly summaryRepository: Repository<CandidateSummary>,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Ensures the candidate exists and belongs to the recruiter's workspace.
   * @throws NotFoundException if candidate not found
   * @throws ForbiddenException if candidate belongs to another workspace
   */
  async ensureCandidateInWorkspace(
    candidateId: string,
    workspaceId: string,
  ): Promise<SampleCandidate> {
    const candidate = await this.candidateRepository.findOne({
      where: { id: candidateId },
    });
    if (!candidate) {
      throw new NotFoundException(`Candidate ${candidateId} not found`);
    }
    if (candidate.workspaceId !== workspaceId) {
      throw new ForbiddenException(
        'You do not have access to this candidate',
      );
    }
    return candidate;
  }

  async createDocument(
    user: AuthUser,
    candidateId: string,
    dto: CreateCandidateDocumentDto,
  ): Promise<CandidateDocument> {
    await this.ensureCandidateInWorkspace(candidateId, user.workspaceId);

    const storageKey =
      dto.storageKey?.trim() ||
      `workspaces/${user.workspaceId}/candidates/${candidateId}/${createCandidateDocumentId()}_${dto.fileName}`;

    const doc = this.documentRepository.create({
      id: createCandidateDocumentId(),
      candidateId,
      documentType: dto.documentType,
      fileName: dto.fileName.trim(),
      storageKey,
      rawText: dto.rawText,
    });
    return this.documentRepository.save(doc);
  }

  /**
   * Creates a pending summary record, enqueues generation job, returns 202-style payload.
   */
  async requestSummaryGeneration(
    user: AuthUser,
    candidateId: string,
  ): Promise<{ summaryId: string; status: string }> {
    await this.ensureCandidateInWorkspace(candidateId, user.workspaceId);

    const summary = this.summaryRepository.create({
      id: createCandidateSummaryId(),
      candidateId,
      status: 'pending',
      score: null,
      strengths: null,
      concerns: null,
      summary: null,
      recommendedDecision: null,
      provider: null,
      promptVersion: null,
      errorMessage: null,
    });
    const saved = await this.summaryRepository.save(summary);

    const payload: SummaryGenerationJobPayload = { summaryId: saved.id };
    this.queueService.enqueue(SUMMARY_GENERATION_JOB_NAME, payload);

    return { summaryId: saved.id, status: 'pending' };
  }

  async listSummaries(
    user: AuthUser,
    candidateId: string,
  ): Promise<CandidateSummary[]> {
    await this.ensureCandidateInWorkspace(candidateId, user.workspaceId);
    return this.summaryRepository.find({
      where: { candidateId },
      order: { createdAt: 'DESC' },
    });
  }

  async getSummary(
    user: AuthUser,
    candidateId: string,
    summaryId: string,
  ): Promise<CandidateSummary> {
    await this.ensureCandidateInWorkspace(candidateId, user.workspaceId);
    const summary = await this.summaryRepository.findOne({
      where: { id: summaryId, candidateId },
    });
    if (!summary) {
      throw new NotFoundException(`Summary ${summaryId} not found`);
    }
    return summary;
  }
}
