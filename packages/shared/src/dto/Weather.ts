export interface CurrentWeatherDTO {
  readonly current: { readonly tempF: number; readonly condition: string } | null;
}
