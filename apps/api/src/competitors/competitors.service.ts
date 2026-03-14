import { Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { CreateCompetitorDto } from './dto/create-competitor.dto';
import { UpdateCompetitorDto } from './dto/update-competitor.dto';
import { InstagramProfile } from './competitor.model';

@Injectable()
export class CompetitorsService {
  private readonly dbPath = join(process.cwd(), 'db', 'competitors.json');

  constructor() {
    this.ensureDb();
  }

  findAll(): InstagramProfile[] {
    return this.readDb();
  }

  findOne(id: string): InstagramProfile {
    const competitor = this.readDb().find((item) => item.id === id);
    if (!competitor) {
      throw new NotFoundException(`Instagram profile ${id} not found`);
    }
    return competitor;
  }

  create(dto: CreateCompetitorDto): InstagramProfile {
    const competitors = this.readDb();
    const item: InstagramProfile = {
      id: this.slugify(dto.brandName) || randomUUID(),
      ...dto,
      updatedAt: new Date().toISOString(),
    };
    competitors.push(item);
    this.writeDb(competitors);
    return item;
  }

  update(id: string, dto: UpdateCompetitorDto): InstagramProfile {
    const competitors = this.readDb();
    const index = competitors.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new NotFoundException(`Instagram profile ${id} not found`);
    }

    const merged: InstagramProfile = {
      ...competitors[index],
      ...dto,
      posts: dto.posts ?? competitors[index].posts,
      updatedAt: new Date().toISOString(),
    };

    competitors[index] = merged;
    this.writeDb(competitors);
    return merged;
  }

  remove(id: string): void {
    const competitors = this.readDb();
    const updated = competitors.filter((item) => item.id !== id);
    if (updated.length === competitors.length) {
      throw new NotFoundException(`Instagram profile ${id} not found`);
    }
    this.writeDb(updated);
  }

  private ensureDb(): void {
    const dir = join(process.cwd(), 'db');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (!existsSync(this.dbPath)) {
      writeFileSync(this.dbPath, '[]', 'utf8');
    }
  }

  private readDb(): InstagramProfile[] {
    const raw = readFileSync(this.dbPath, 'utf8');
    return JSON.parse(raw) as InstagramProfile[];
  }

  private writeDb(data: InstagramProfile[]): void {
    writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf8');
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
