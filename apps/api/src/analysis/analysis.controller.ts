import { Body, Controller, Get, Post } from '@nestjs/common';
import { LiveInstagramResearchDto } from './dto/live-instagram-research.dto';
import { RecalculateGtmDto } from './dto/recalculate-gtm.dto';
import { AnalysisService } from './analysis.service';
import { CollectionAgentService } from './collection-agent.service';
import { DashboardAgentService } from './dashboard-agent.service';
import { DiscoveryAgentService } from './discovery-agent.service';
import { InsightAgentService } from './insight-agent.service';
import { LiveInstagramResearchService } from './live-instagram-research.service';

@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly analysisService: AnalysisService,
    private readonly liveInstagramResearchService: LiveInstagramResearchService,
    private readonly discoveryAgentService: DiscoveryAgentService,
    private readonly collectionAgentService: CollectionAgentService,
    private readonly insightAgentService: InsightAgentService,
    private readonly dashboardAgentService: DashboardAgentService,
  ) {}

  @Get('catalog')
  getCatalog() {
    return this.analysisService.getCatalog();
  }

  @Post('instagram-research')
  runInstagramResearch(@Body() dto: RecalculateGtmDto) {
    return this.analysisService.runInstagramResearch(dto);
  }

  @Post('instagram-research/live')
  runLiveInstagramResearch(@Body() dto: LiveInstagramResearchDto) {
    return this.dashboardAgentService.run(dto);
  }

  @Post('instagram-research/discovery')
  runDiscoveryAgent(@Body() dto: LiveInstagramResearchDto) {
    return this.discoveryAgentService.run(dto);
  }

  @Post('instagram-research/collect')
  runCollectionAgent(@Body() dto: LiveInstagramResearchDto) {
    return this.collectionAgentService.run(dto);
  }

  @Post('instagram-research/insights')
  runInsightAgent(@Body() dto: LiveInstagramResearchDto) {
    return this.insightAgentService.run(dto);
  }

  @Post('instagram-research/dashboard')
  runDashboardAgent(@Body() dto: LiveInstagramResearchDto) {
    return this.dashboardAgentService.run(dto);
  }
}
