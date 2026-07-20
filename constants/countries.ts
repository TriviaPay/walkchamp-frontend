export interface Country {
  name: string;
  code: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { name: "United States", code: "US", flag: "🇺🇸" },
  { name: "India", code: "IN", flag: "🇮🇳" },
  { name: "United Kingdom", code: "GB", flag: "🇬🇧" },
  { name: "Germany", code: "DE", flag: "🇩🇪" },
  { name: "France", code: "FR", flag: "🇫🇷" },
  { name: "Japan", code: "JP", flag: "🇯🇵" },
  { name: "South Korea", code: "KR", flag: "🇰🇷" },
  { name: "Brazil", code: "BR", flag: "🇧🇷" },
  { name: "Canada", code: "CA", flag: "🇨🇦" },
  { name: "Australia", code: "AU", flag: "🇦🇺" },
  { name: "China", code: "CN", flag: "🇨🇳" },
  { name: "Mexico", code: "MX", flag: "🇲🇽" },
  { name: "Italy", code: "IT", flag: "🇮🇹" },
  { name: "Spain", code: "ES", flag: "🇪🇸" },
  { name: "Russia", code: "RU", flag: "🇷🇺" },
  { name: "Turkey", code: "TR", flag: "🇹🇷" },
  { name: "Saudi Arabia", code: "SA", flag: "🇸🇦" },
  { name: "Indonesia", code: "ID", flag: "🇮🇩" },
  { name: "Nigeria", code: "NG", flag: "🇳🇬" },
  { name: "South Africa", code: "ZA", flag: "🇿🇦" },
  { name: "Argentina", code: "AR", flag: "🇦🇷" },
  { name: "Egypt", code: "EG", flag: "🇪🇬" },
  { name: "Pakistan", code: "PK", flag: "🇵🇰" },
  { name: "Bangladesh", code: "BD", flag: "🇧🇩" },
  { name: "Philippines", code: "PH", flag: "🇵🇭" },
  { name: "Vietnam", code: "VN", flag: "🇻🇳" },
  { name: "Thailand", code: "TH", flag: "🇹🇭" },
  { name: "Malaysia", code: "MY", flag: "🇲🇾" },
  { name: "Netherlands", code: "NL", flag: "🇳🇱" },
  { name: "Sweden", code: "SE", flag: "🇸🇪" },
  { name: "Norway", code: "NO", flag: "🇳🇴" },
  { name: "Poland", code: "PL", flag: "🇵🇱" },
  { name: "Ukraine", code: "UA", flag: "🇺🇦" },
  { name: "Kenya", code: "KE", flag: "🇰🇪" },
  { name: "Ethiopia", code: "ET", flag: "🇪🇹" },
  { name: "Ghana", code: "GH", flag: "🇬🇭" },
  { name: "New Zealand", code: "NZ", flag: "🇳🇿" },
  { name: "Singapore", code: "SG", flag: "🇸🇬" },
  { name: "UAE", code: "AE", flag: "🇦🇪" },
  { name: "Israel", code: "IL", flag: "🇮🇱" },
];

export function getCountryByCode(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}
