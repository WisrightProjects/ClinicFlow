// Doctor search bar + specialty filter driven by the specialties that actually exist in the DB
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SearchFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  specialty: string;
  onSpecialtyChange: (value: string) => void;
}

export function SearchFilters({
  searchTerm,
  onSearchChange,
  specialty,
  onSpecialtyChange,
}: SearchFiltersProps) {
  // Distinct specialties of existing doctors — keeps filter options in sync with real data
  const { data: specialties = [] } = useQuery<string[]>({
    queryKey: ["/api/specialties"],
  });

  return (
    <div className="bg-white shadow-sm border-b">
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search doctors by name..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={specialty || "all"} onValueChange={onSpecialtyChange}>
            <SelectTrigger className="w-full md:w-[200px]">
              <SelectValue placeholder="All Specialties" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Specialties</SelectItem>
              {specialties.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
