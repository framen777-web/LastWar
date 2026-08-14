export type CategoryFieldMapping = { categoryKey: string; column: string; divisor: number };

export type CustomFieldMapping = { column: string; categoryKey: string; divisor: number };

export type SquadsMapping = { air?: string; tank?: string; missile?: string; fourth?: string };

export type ImportMapping = {
  memberColumn: string;
  weekColumn: string;
  weekFrom?: number;
  weekTo?: number;
  categoryMappings: CategoryFieldMapping[];
  squadsMapping?: SquadsMapping;
  customFields: CustomFieldMapping[];
  allianceRankColumn?: string;
};

export type MappedRow = {
  memberName: string;
  weekNumber: number;
  categoryValues: { categoryKey: string; value: number }[];
  squadsFields: { air: number | null; tank: number | null; missile: number | null; fourth: number | null } | null;
  allianceRank: string | null;
};
