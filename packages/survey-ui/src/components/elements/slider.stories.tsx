import type { Meta, StoryObj } from "@storybook/react";
import {
  type BaseStylingOptions,
  type LabelStylingOptions,
  commonArgTypes,
  createCSSVariablesDecorator,
  createStatefulRender,
  elementStylingArgTypes,
  inputStylingArgTypes,
  labelStylingArgTypes,
  pickArgTypes,
  surveyStylingArgTypes,
} from "../../lib/story-helpers";
import { Slider, type SliderProps } from "./slider";

/**
 * Story args are the component's own props widened by the styling options the
 * CSS-variable decorator understands. The `Record<string, unknown>` tail is what
 * lets that decorator read arbitrary styling keys off the story context without
 * every story having to redeclare them.
 */
type StoryProps = SliderProps & Partial<BaseStylingOptions & LabelStylingOptions> & Record<string, unknown>;

const meta: Meta<StoryProps> = {
  title: "UI-package/Elements/Slider",
  component: Slider,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A slider element that lets a respondent pick a single value on a continuous numeric scale defined by a minimum, maximum and step increment. Optional endpoint labels describe the extremes and an optional readout shows the selected value.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    ...commonArgTypes,
    min: {
      control: { type: "number" },
      description: "Lower bound of the selectable range",
      table: { category: "Content" },
    },
    max: {
      control: { type: "number" },
      description: "Upper bound of the selectable range",
      table: { category: "Content" },
    },
    step: {
      control: { type: "number", min: 0 },
      description: "Increment between selectable values",
      table: { category: "Content" },
    },
    value: {
      control: { type: "number" },
      description: "Currently selected value; leave empty to render the unanswered state",
      table: { category: "State" },
    },
    lowerLabel: {
      control: "text",
      description: "Label for the lower end of the scale",
      table: { category: "Content" },
    },
    upperLabel: {
      control: "text",
      description: "Label for the upper end of the scale",
      table: { category: "Content" },
    },
    showValue: {
      control: "boolean",
      description: "Whether the currently selected value is displayed above the track",
      table: { category: "Content" },
    },
  },
  // The component is controlled, so a stateful wrapper owns the value for every
  // story. Without it the thumb would snap back on release instead of moving.
  render: createStatefulRender(Slider),
};

export default meta;
type Story = StoryObj<StoryProps>;

/**
 * Interactive playground for the design tokens this control consumes.
 *
 * The decorator maps each styling arg onto its `--fb-*` custom property, so the
 * brand colour drives the filled range and the thumb border, while the input
 * tokens drive the track background, border and corner radius.
 */
export const StylingPlayground: Story = {
  args: {
    elementId: "slider-1",
    inputId: "slider-input-1",
    headline: "How likely are you to recommend us?",
    description: "Drag the handle to pick a value",
    min: 0,
    max: 100,
    step: 5,
    lowerLabel: "Not likely",
    upperLabel: "Very likely",
    elementHeadlineFontFamily: "system-ui, sans-serif",
    elementHeadlineFontSize: "1.125rem",
    elementHeadlineFontWeight: "600",
    elementHeadlineColor: "#1e293b",
    elementDescriptionFontFamily: "system-ui, sans-serif",
    elementDescriptionFontSize: "0.875rem",
    elementDescriptionFontWeight: "400",
    elementDescriptionColor: "#64748b",
    labelFontFamily: "system-ui, sans-serif",
    labelFontSize: "0.75rem",
    labelFontWeight: "400",
    labelColor: "#64748b",
    labelOpacity: "1",
  },
  argTypes: {
    ...elementStylingArgTypes,
    ...labelStylingArgTypes,
    ...pickArgTypes(inputStylingArgTypes, [
      "inputBgColor",
      "inputBorderColor",
      "inputColor",
      "inputFontWeight",
      "inputBorderRadius",
    ]),
    ...surveyStylingArgTypes,
  },
  decorators: [createCSSVariablesDecorator<StoryProps>()],
};

/**
 * Resting state of a freshly rendered element.
 *
 * `value` is deliberately omitted so the control renders as unanswered: the
 * thumb parks at `min` but is filled with the input background rather than the
 * brand colour, and no readout is shown until the respondent interacts.
 */
export const Default: Story = {
  args: {
    elementId: "slider-default",
    inputId: "slider-input-default",
    headline: "How likely are you to recommend us?",
    min: 0,
    max: 100,
    step: 5,
  },
};

export const WithDescription: Story = {
  args: {
    elementId: "slider-description",
    inputId: "slider-input-description",
    headline: "How likely are you to recommend us?",
    description: "0 means not likely at all, 100 means extremely likely",
    min: 0,
    max: 100,
    step: 5,
  },
};

export const Required: Story = {
  args: {
    elementId: "slider-required",
    inputId: "slider-input-required",
    headline: "How likely are you to recommend us?",
    min: 0,
    max: 100,
    step: 5,
    required: true,
  },
};

export const WithError: Story = {
  args: {
    elementId: "slider-error",
    inputId: "slider-input-error",
    headline: "How likely are you to recommend us?",
    min: 0,
    max: 100,
    step: 5,
    required: true,
    errorMessage: "Please select a value",
  },
};

/**
 * Non-interactive state. A value is supplied so the dimmed control still shows
 * a filled range, a brand-filled thumb and the selected-value readout.
 */
export const Disabled: Story = {
  args: {
    elementId: "slider-disabled",
    inputId: "slider-input-disabled",
    headline: "How likely are you to recommend us?",
    min: 0,
    max: 100,
    step: 5,
    value: 50,
    disabled: true,
  },
};

/**
 * Right-to-left rendering. The track, the filled range and the endpoint label
 * row all invert together, so the lower label sits on the right.
 */
export const RTL: Story = {
  args: {
    elementId: "slider-rtl",
    dir: "rtl",
    inputId: "slider-input-rtl",
    headline: "ما مدى احتمالية أن توصي بنا؟",
    description: "اسحب المؤشر لاختيار قيمة",
    min: 0,
    max: 100,
    step: 5,
    lowerLabel: "غير محتمل",
    upperLabel: "محتمل جداً",
  },
};
