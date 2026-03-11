import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { FakeSummarizationProvider } from './fake-summarization.provider';
import { GeminiSummarizationProvider } from './gemini-summarization.provider';
import { SUMMARIZATION_PROVIDER } from './summarization-provider.interface';
import type { SummarizationProvider } from './summarization-provider.interface';

@Module({
  providers: [
    FakeSummarizationProvider,
    GeminiSummarizationProvider,
    {
      provide: SUMMARIZATION_PROVIDER,
      useFactory: (
        configService: ConfigService,
        fake: FakeSummarizationProvider,
        gemini: GeminiSummarizationProvider,
      ): SummarizationProvider => {
        const apiKey = configService.get<string>('GEMINI_API_KEY');
        return apiKey?.trim() ? gemini : fake;
      },
      inject: [ConfigService, FakeSummarizationProvider, GeminiSummarizationProvider],
    },
  ],
  exports: [SUMMARIZATION_PROVIDER, FakeSummarizationProvider, GeminiSummarizationProvider],
})
export class LlmModule {}
