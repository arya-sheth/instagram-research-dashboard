import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateCompetitorDto } from './dto/create-competitor.dto';
import { UpdateCompetitorDto } from './dto/update-competitor.dto';
import { CompetitorsService } from './competitors.service';

@Controller('competitors')
export class CompetitorsController {
  constructor(private readonly competitorsService: CompetitorsService) {}

  @Get()
  findAll() {
    return this.competitorsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.competitorsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCompetitorDto) {
    return this.competitorsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCompetitorDto) {
    return this.competitorsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    this.competitorsService.remove(id);
    return { deleted: true };
  }
}
