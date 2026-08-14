export type ConductorHistoryMapping = {
  weekColumn: string;
  conductorNameColumn: string;
  pointsColumn: string;
  passengerNameColumn?: string;
  weekFrom?: number;
  weekTo?: number;
};

export type MappedHistoryRow = {
  weekNumber: number;
  conductorName: string;
  points: number;
  passengerName: string | null;
};
