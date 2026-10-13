import type { Answers } from "@/lib/intake/answers";

export type Catalogue = {
  ageRanges: { slug: string; label: string; open: boolean }[];
  communities: {
    slug: string;
    name: string;
    description: string;
    goals: { slug: string; title: string }[];
  }[];
};

export type StepProps = {
  answers: Answers;
  set: (patch: Partial<Answers>) => void;
};
