import { Module } from '@nestjs/common';
import { CompetitorsModule } from '../competitors/competitors.module';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { CollectionAgentService } from './collection-agent.service';
import { DashboardAgentService } from './dashboard-agent.service';
import { DiscoveryAgentService } from './discovery-agent.service';
import { InsightAgentService } from './insight-agent.service';
import { InstagramPlaywrightService } from './instagram-playwright.service';
import { LiveInstagramResearchService } from './live-instagram-research.service';

@Module({
  imports: [CompetitorsModule],
  controllers: [AnalysisController],
  providers: [
    AnalysisService,
    LiveInstagramResearchService,
    InstagramPlaywrightService,
    DiscoveryAgentService,
    CollectionAgentService,
    InsightAgentService,
    DashboardAgentService,
  ],
})
export class AnalysisModule {}
