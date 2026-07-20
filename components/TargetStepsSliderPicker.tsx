import React from "react";
import DiscreteSliderPicker from "@/components/DiscreteSliderPicker";
import {
  formatStepLabel,
  formatStepShortLabel,
  isTestingTargetSteps,
  type TargetStepDuration,
} from "@/utils/targetSteps";

export default function TargetStepsSliderPicker({
  duration,
  options,
  value,
  onChange,
  accent,
}: {
  duration: TargetStepDuration;
  options: number[];
  value: number;
  onChange: (v: number) => void;
  accent: string;
}) {
  const isTesting = isTestingTargetSteps(duration, value);
  const maxLabel = formatStepShortLabel(options[options.length - 1] ?? value);

  return (
    <DiscreteSliderPicker
      options={options}
      value={value}
      onChange={onChange}
      accent={accent}
      formatLabel={formatStepLabel}
      minLabel="Testing: 100 steps"
      maxLabel={maxLabel}
      badge={isTesting ? {
        title: "Testing Mode",
        subtitle: "This low target is intended only for testing.",
      } : null}
    />
  );
}
