import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import type { DocumentType } from '../../entities/candidate-document.entity';

const DOCUMENT_TYPES: DocumentType[] = ['resume', 'cover_letter', 'other'];

export class CreateCandidateDocumentDto {
  @IsString()
  @IsIn(DOCUMENT_TYPES)
  documentType!: DocumentType;

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  storageKey?: string;

  @IsString()
  rawText!: string;
}
