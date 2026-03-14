import { Module } from '@nestjs/common';
import { AnalysisModule } from './analysis/analysis.module';
import { CompetitorsModule } from './competitors/competitors.module';

@Module({
  imports: [CompetitorsModule, AnalysisModule],
})
export class AppModule {}
