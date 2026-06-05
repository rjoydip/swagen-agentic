import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Skill, SkillContext, SwagenConfig } from "../core/types.ts";
import { buildSkillSystemPrompt } from "../core/prompts.ts";
import { logger } from "../utils/logger.ts";

export interface ResolvedSkills {
  active: Skill[];
  inactive: Skill[];
}

const BUILTIN_PATHS = ["./rest.ts", "./graphql.ts", "./grpc.ts", "./soap.ts"] as const;

export class SkillManager {
  private registry = new Map<string, Skill>();

  register(skill: Skill): void {
    if (this.registry.has(skill.name)) {
      logger.warn("skills", `"${skill.name}" already registered — overwriting`);
    }
    this.registry.set(skill.name, skill);
  }

  async registerBuiltins(): Promise<void> {
    for (const path of BUILTIN_PATHS) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const mod = await import(path);
        const skill: Skill | undefined = mod.skill ?? mod.default;
        if (skill?.name) {
          this.register(skill);
        }
      } catch {
        // Builtin skill not found — skip silently
      }
    }
  }

  get(name: string): Skill | undefined {
    return this.registry.get(name);
  }

  list(): Skill[] {
    return [...this.registry.values()];
  }

  async loadUserSkills(config: SwagenConfig): Promise<void> {
    const items = config.skills;
    if (!items?.length) return;

    for (const item of items) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const mod = await import(item.from);
        const skill: Skill = mod.default ?? mod;
        if (!skill?.name || !skill?.activation) {
          logger.warn("skills", `Invalid skill at "${item.from}" — missing name or activation`);
          continue;
        }
        this.register(skill);
      } catch (err) {
        logger.error("skills", `Failed to load skill "${item.from}": ${err}`);
      }
    }
  }

  resolve(ctx: SkillContext): ResolvedSkills {
    const active: Skill[] = [];
    const inactive: Skill[] = [];

    for (const skill of this.registry.values()) {
      try {
        if (skill.activation(ctx)) {
          active.push(skill);
        } else {
          inactive.push(skill);
        }
      } catch (err) {
        logger.warn("skills", `"${skill.name}" activation threw: ${err}`);
        inactive.push(skill);
      }
    }

    return { active, inactive };
  }

  buildSystemPrompt(active: Skill[], base: string): string {
    return buildSkillSystemPrompt(
      base,
      active.map((s) => s.systemPrompt).filter(Boolean) as string[],
    );
  }

  collectTools(active: Skill[]): AgentTool<any, any>[] {
    return active.flatMap((s) => s.tools ?? []);
  }

  collectHooks(active: Skill[]) {
    return active.map((s) => s.hooks).filter((h): h is NonNullable<typeof h> => !!h);
  }
}
