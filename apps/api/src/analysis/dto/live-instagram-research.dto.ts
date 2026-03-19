import { IsArray, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class LiveInstagramResearchDto {
  @IsString()
  companyName!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9._]+$/)
  instagramHandle!: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  competitorLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(500)
  recentPostLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  forceRefresh?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmedCompetitorDto)
  confirmedCompetitors?: ConfirmedCompetitorDto[];
}

export class ConfirmedCompetitorDto {
  @IsString()
  companyName!: string;

  @IsString()
  handle!: string;
}
