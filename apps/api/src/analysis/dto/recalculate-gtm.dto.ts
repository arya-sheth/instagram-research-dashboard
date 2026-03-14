import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RecalculateGtmDto {
  @IsString()
  companyName!: string;

  @IsOptional()
  @IsString()
  instagramHandle?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  competitorLimit?: number;
}
