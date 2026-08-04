import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@formbricks/database";
import { DatabaseError, ResourceNotFoundError } from "@formbricks/types/errors";
import { TLanguage } from "@formbricks/types/project";
import { TResponseFilterCriteria } from "@formbricks/types/responses";
import { TSurveyElement, TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import { TSurvey, TSurveySummary } from "@formbricks/types/surveys/types";
import { getQuotasSummary } from "@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/lib/survey";
import { getDisplayCountBySurveyId } from "@/lib/display/service";
import { getLocalizedValue } from "@/lib/i18n/utils";
import { getResponseCountBySurveyId } from "@/lib/response/service";
import { getSurvey } from "@/lib/survey/service";
import { evaluateLogic, performActions } from "@/lib/surveyLogic/utils";
import { getElementsFromBlocks } from "@/modules/survey/lib/client-utils";
import {
  getElementSummary,
  getResponsesForSummary,
  getSurveySummary,
  getSurveySummaryDropOff,
  getSurveySummaryMeta,
} from "./surveySummary";
// Ensure this path is correct
import { convertFloatTo2Decimal } from "./utils";

vi.mock("@/lib/display/service", () => ({
  getDisplayCountBySurveyId: vi.fn(),
}));
vi.mock("@/lib/i18n/utils", () => ({
  getLocalizedValue: vi.fn((value, lang) => {
    // Handle the case when value is undefined or null
    if (!value) return "";
    return value[lang] || value.default || "";
  }),
}));
vi.mock("@/lib/response/service", () => ({
  getResponseCountBySurveyId: vi.fn(),
}));
vi.mock("@/lib/response/utils", () => ({
  buildWhereClause: vi.fn(() => ({})),
}));
vi.mock("@/lib/survey/service", () => ({
  getSurvey: vi.fn(),
}));
vi.mock("@/lib/surveyLogic/utils", () => ({
  evaluateLogic: vi.fn(),
  performActions: vi.fn(() => ({ jumpTarget: undefined, requiredQuestionIds: [], calculations: {} })),
}));
vi.mock("@/lib/utils/validate", () => ({
  validateInputs: vi.fn(),
}));
vi.mock("@formbricks/database", () => ({
  prisma: {
    response: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/app/(app)/environments/[environmentId]/surveys/[surveyId]/(analysis)/summary/lib/survey", () => ({
  getQuotasSummary: vi.fn(),
}));

vi.mock("./utils", () => ({
  convertFloatTo2Decimal: vi.fn((num) =>
    num !== undefined && num !== null ? parseFloat(num.toFixed(2)) : 0
  ),
}));

const mockSurveyId = "survey_123";

const mockBaseSurvey: TSurvey = {
  id: mockSurveyId,
  name: "Test Survey",
  blocks: [],
  questions: [],
  welcomeCard: { enabled: false, headline: { default: "Welcome" } } as unknown as TSurvey["welcomeCard"],
  endings: [],
  hiddenFields: { enabled: false, fieldIds: [] },
  languages: [
    { language: { id: "lang1", code: "en" } as unknown as TLanguage, default: true, enabled: true },
  ],
  variables: [],
  autoClose: null,
  triggers: [],
  status: "inProgress",
  type: "app",
  styling: {},
  segment: null,
  recontactDays: null,
  autoComplete: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  displayOption: "displayOnce",
  displayPercentage: null,
  environmentId: "env_123",
  singleUse: null,
  surveyClosedMessage: null,
  pin: null,
  createdBy: "user_123",
  isSingleResponsePerEmailEnabled: false,
  isVerifyEmailEnabled: false,
  projectOverwrites: null,
  showLanguageSwitch: false,
  isBackButtonHidden: false,
  followUps: [],
  recaptcha: { enabled: false, threshold: 0.5 },
} as unknown as TSurvey;

const mockResponses = [
  {
    id: "res1",
    data: { q1: "Answer 1" },
    updatedAt: new Date(),
    contact: null,
    contactAttributes: {},
    language: "en",
    ttc: { q1: 100, _total: 100 },
    finished: true,
  },
  {
    id: "res2",
    data: { q1: "Answer 2" },
    updatedAt: new Date(),
    contact: null,
    contactAttributes: {},
    language: "en",
    ttc: { q1: 150, _total: 150 },
    finished: true,
  },
  {
    id: "res3",
    data: {},
    updatedAt: new Date(),
    contact: null,
    contactAttributes: {},
    language: "en",
    ttc: {},
    finished: false,
  },
] as any;

const mockQuotas = [
  {
    id: "quota1",
    name: "Quota 1",
    limit: 10,
    count: 5,
    percentage: 50,
  },
  {
    id: "quota2",
    name: "Quota 2",
    limit: 20,
    count: 10,
    percentage: 50,
  },
];

describe("getSurveySummaryMeta", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(convertFloatTo2Decimal).mockImplementation((num) =>
      num !== undefined && num !== null ? parseFloat(num.toFixed(2)) : 0
    );
  });

  test("calculates meta correctly", () => {
    const meta = getSurveySummaryMeta(mockResponses, 10, mockQuotas);
    expect(meta.displayCount).toBe(10);
    expect(meta.totalResponses).toBe(3);
    expect(meta.startsPercentage).toBe(30);
    expect(meta.completedResponses).toBe(2);
    expect(meta.completedPercentage).toBe(20);
    expect(meta.dropOffCount).toBe(1);
    expect(meta.dropOffPercentage).toBe(33.33); // (1/3)*100
    expect(meta.ttcAverage).toBe(125); // (100+150)/2
    expect(meta.quotasCompleted).toBe(0);
    expect(meta.quotasCompletedPercentage).toBe(0);
  });

  test("handles zero display count", () => {
    const meta = getSurveySummaryMeta(mockResponses, 0, mockQuotas);
    expect(meta.startsPercentage).toBe(0);
    expect(meta.completedPercentage).toBe(0);
  });

  test("handles zero responses", () => {
    const meta = getSurveySummaryMeta([], 10, mockQuotas);
    expect(meta.totalResponses).toBe(0);
    expect(meta.completedResponses).toBe(0);
    expect(meta.dropOffCount).toBe(0);
    expect(meta.dropOffPercentage).toBe(0);
    expect(meta.ttcAverage).toBe(0);
  });
});

describe("getSurveySummaryDropOff", () => {
  const surveyWithBlocks: TSurvey = {
    ...mockBaseSurvey,
    blocks: [
      {
        id: "block1",
        name: "Block 1",
        elements: [
          {
            id: "q1",
            type: TSurveyElementTypeEnum.OpenText,
            headline: { default: "Q1" },
            required: true,
            inputType: "text",
            charLimit: { enabled: false },
          },
          {
            id: "q2",
            type: TSurveyElementTypeEnum.OpenText,
            headline: { default: "Q2" },
            required: true,
            inputType: "text",
            charLimit: { enabled: false },
          },
        ],
      },
    ],
    questions: [],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getLocalizedValue).mockImplementation((val, _) => val?.default || "");
    vi.mocked(convertFloatTo2Decimal).mockImplementation((num) =>
      num !== undefined && num !== null ? parseFloat(num.toFixed(2)) : 0
    );
    vi.mocked(evaluateLogic).mockReturnValue(false); // Default: no logic triggers
    vi.mocked(performActions).mockReturnValue({
      jumpTarget: undefined,
      requiredElementIds: [],
      calculations: {},
    });
  });

  test("calculates dropOff correctly with welcome card disabled", () => {
    const responses = [
      {
        id: "r1",
        data: { q1: "a" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: "en",
        ttc: { q1: 10 },
        finished: false,
      }, // Dropped at q2
      {
        id: "r2",
        data: { q1: "b", q2: "c" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: "en",
        ttc: { q1: 10, q2: 10 },
        finished: true,
      }, // Completed
    ] as any;
    const displayCount = 5; // 5 displays
    const dropOff = getSurveySummaryDropOff(
      surveyWithBlocks,
      getElementsFromBlocks(surveyWithBlocks.blocks),
      responses,
      displayCount
    );

    expect(dropOff.length).toBe(2);
    // Q1
    expect(dropOff[0].elementId).toBe("q1");
    expect(dropOff[0].impressions).toBe(displayCount); // Welcome card disabled, so first question impressions = displayCount
    expect(dropOff[0].dropOffCount).toBe(displayCount - responses.length); // 5 displays - 2 started = 3 dropped before q1
    expect(dropOff[0].dropOffPercentage).toBe(60); // (3/5)*100
    expect(dropOff[0].ttc).toBe(10);

    // Q2
    expect(dropOff[1].elementId).toBe("q2");
    expect(dropOff[1].impressions).toBe(responses.length); // 2 responses reached q1, so 2 impressions for q2
    expect(dropOff[1].dropOffCount).toBe(1); // 1 response dropped at q2
    expect(dropOff[1].dropOffPercentage).toBe(50); // (1/2)*100
    expect(dropOff[1].ttc).toBe(10);
  });

  test("handles logic jumps", () => {
    const surveyWithLogic: TSurvey = {
      ...mockBaseSurvey,
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [
            {
              id: "q1",
              type: TSurveyElementTypeEnum.OpenText,
              headline: { default: "Q1" },
              required: true,
              inputType: "text",
              charLimit: { enabled: false },
            },
          ] as TSurveyElement[],
        },
        {
          id: "block2",
          name: "Block 2",
          elements: [
            {
              id: "q2",
              type: TSurveyElementTypeEnum.OpenText,
              headline: { default: "Q2" },
              required: true,
              inputType: "text",
              charLimit: { enabled: false },
            },
          ] as TSurveyElement[],
          logic: [
            {
              id: "logic1",
              conditions: {
                id: "condition1",
                connector: "and" as const,
                conditions: [
                  {
                    id: "c1",
                    leftOperand: {
                      type: "element" as const,
                      value: "q2",
                    },
                    operator: "equals" as const,
                    rightOperand: {
                      type: "static" as const,
                      value: "b",
                    },
                  },
                ],
              },
              actions: [
                {
                  id: "action1",
                  objective: "jumpToBlock" as const,
                  target: "q4",
                },
              ],
            },
          ],
        },
        {
          id: "block3",
          name: "Block 3",
          elements: [
            {
              id: "q3",
              type: TSurveyElementTypeEnum.OpenText,
              headline: { default: "Q3" },
              required: true,
              inputType: "text",
              charLimit: { enabled: false },
            },
          ] as TSurveyElement[],
        },
        {
          id: "block4",
          name: "Block 4",
          elements: [
            {
              id: "q4",
              type: TSurveyElementTypeEnum.OpenText,
              headline: { default: "Q4" },
              required: true,
              inputType: "text",
              charLimit: { enabled: false },
            },
          ] as TSurveyElement[],
        },
      ],
      questions: [],
    };
    const responses = [
      {
        id: "r1",
        data: { q1: "a", q2: "b" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: "en",
        ttc: { q1: 10, q2: 10 },
        finished: false,
      }, // Jumps from q2 to q4, drops at q4
    ];
    vi.mocked(evaluateLogic).mockImplementation((_s, data, _v, _, _l) => {
      // Simulate logic on q2 triggering
      return data.q2 === "b";
    });
    vi.mocked(performActions).mockImplementation((_s, actions, _d, _v) => {
      if (actions[0] && "objective" in actions[0] && actions[0].objective === "jumpToBlock") {
        return { jumpTarget: actions[0].target, requiredElementIds: [], calculations: {} };
      }
      return { jumpTarget: undefined, requiredElementIds: [], calculations: {} };
    });

    const dropOff = getSurveySummaryDropOff(
      surveyWithLogic,
      getElementsFromBlocks(surveyWithLogic.blocks),
      responses,
      1
    );

    expect(dropOff[0].impressions).toBe(1); // q1
    expect(dropOff[1].impressions).toBe(1); // q2
    expect(dropOff[2].impressions).toBe(0); // q3 (skipped)
    expect(dropOff[3].impressions).toBe(1); // q4 (jumped to)
    expect(dropOff[3].dropOffCount).toBe(1); // Dropped at q4
  });
});

describe("getQuestionSummary", () => {
  const survey: TSurvey = {
    ...mockBaseSurvey,
    blocks: [
      {
        id: "block1",
        name: "Block 1",
        elements: [
          {
            id: "q_open",
            type: TSurveyElementTypeEnum.OpenText,
            headline: { default: "Open Text" },
            required: false,
            inputType: "text",
            charLimit: { enabled: false },
          },
          {
            id: "q_multi_single",
            type: TSurveyElementTypeEnum.MultipleChoiceSingle,
            headline: { default: "Multi Single" },
            required: false,
            choices: [
              { id: "c1", label: { default: "Choice 1" } },
              { id: "c2", label: { default: "Choice 2" } },
            ],
            shuffleOption: "none",
          },
        ],
      },
    ],
    questions: [],
    hiddenFields: { enabled: true, fieldIds: ["hidden1"] },
  };
  const responses = [
    {
      id: "r1",
      data: { q_open: "Open answer", q_multi_single: "Choice 1", hidden1: "Hidden val" },
      updatedAt: new Date(),
      contact: null,
      contactAttributes: {},
      language: "en",
      ttc: {},
      finished: true,
    },
  ];
  const mockDropOff: TSurveySummary["dropOff"] = []; // Simplified for this test

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getLocalizedValue).mockImplementation((val, _) => val?.default || "");
    vi.mocked(convertFloatTo2Decimal).mockImplementation((num) =>
      num !== undefined && num !== null ? parseFloat(num.toFixed(2)) : 0
    );
    // React cache is already mocked globally - no need to mock it again
  });

  test("summarizes OpenText questions", async () => {
    const summary = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      mockDropOff
    );
    const openTextSummary = summary.find((s: any) => s.element?.id === "q_open");
    expect(openTextSummary?.type).toBe(TSurveyElementTypeEnum.OpenText);
    expect(openTextSummary?.responseCount).toBe(1);
    // @ts-expect-error
    expect(openTextSummary?.samples[0].value).toBe("Open answer");
  });

  test("summarizes MultipleChoiceSingle questions", async () => {
    const summary = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      mockDropOff
    );
    const multiSingleSummary = summary.find((s: any) => s.element?.id === "q_multi_single");
    expect(multiSingleSummary?.type).toBe(TSurveyElementTypeEnum.MultipleChoiceSingle);
    expect(multiSingleSummary?.responseCount).toBe(1);
    // @ts-expect-error
    expect(multiSingleSummary?.choices[0].value).toBe("Choice 1");
    // @ts-expect-error
    expect(multiSingleSummary?.choices[0].count).toBe(1);
    // @ts-expect-error
    expect(multiSingleSummary?.choices[0].percentage).toBe(100);
  });

  test("summarizes MultipleChoiceSingle questions with noneOption", async () => {
    const surveyWithNone = {
      ...mockBaseSurvey,
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [
            {
              id: "q_multi_none",
              type: TSurveyElementTypeEnum.MultipleChoiceSingle,
              headline: { default: "Pick one or none" },
              required: false,
              choices: [
                { id: "c1", label: { default: "Choice 1" } },
                { id: "c2", label: { default: "Choice 2" } },
                { id: "none", label: { default: "None of the above" } }, // none option with id "none"
              ],
              shuffleOption: "none",
            },
          ],
        },
      ],
      questions: [],
    };

    const responsesWithNone = [
      {
        id: "r1",
        data: { q_multi_none: "Choice 1" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: "default",
        ttc: {},
        finished: true,
      },
      {
        id: "r2",
        data: { q_multi_none: "None of the above" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: "default",
        ttc: {},
        finished: true,
      },
      {
        id: "r3",
        data: { q_multi_none: "None of the above" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: "default",
        ttc: {},
        finished: true,
      },
    ];

    const summary = await getElementSummary(
      surveyWithNone as unknown as TSurvey,
      getElementsFromBlocks((surveyWithNone as unknown as TSurvey).blocks),
      responsesWithNone,
      []
    );

    const multiNoneSummary = summary.find((s: any) => s.element?.id === "q_multi_none");
    expect(multiNoneSummary?.type).toBe(TSurveyElementTypeEnum.MultipleChoiceSingle);
    expect(multiNoneSummary?.responseCount).toBe(3);

    // Check that "None of the above" option is included in choices
    // @ts-expect-error
    const noneChoice = multiNoneSummary?.choices.find((c: any) => c.value === "None of the above");
    expect(noneChoice).toBeDefined();
    expect(noneChoice?.count).toBe(2);
    expect(noneChoice?.percentage).toBeCloseTo(66.67, 1);
  });

  test("summarizes HiddenFields", async () => {
    const summary = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      mockDropOff
    );
    const hiddenFieldSummary = summary.find((s) => s.type === "hiddenField" && s.id === "hidden1");
    expect(hiddenFieldSummary).toBeDefined();
    expect(hiddenFieldSummary?.responseCount).toBe(1);
    // @ts-expect-error
    expect(hiddenFieldSummary?.samples[0].value).toBe("Hidden val");
  });

  describe("Ranking question type tests", () => {
    test("getQuestionSummary correctly processes ranking question with default language responses", async () => {
      const question = {
        id: "ranking-q1",
        type: TSurveyElementTypeEnum.Ranking,
        headline: { default: "Rank these items" },
        required: true,
        choices: [
          { id: "item1", label: { default: "Item 1" } },
          { id: "item2", label: { default: "Item 2" } },
          { id: "item3", label: { default: "Item 3" } },
        ],
      };

      const survey = {
        id: "survey-1",
        blocks: [
          {
            id: "block1",
            name: "Block 1",
            elements: [question],
          },
        ],
        questions: [],
        languages: [],
        welcomeCard: { enabled: false },
      } as unknown as TSurvey;

      const responses = [
        {
          id: "response-1",
          data: { "ranking-q1": ["Item 1", "Item 2", "Item 3"] },
          updatedAt: new Date(),
          contact: null,
          contactAttributes: {},
          language: null,
          ttc: {},
          finished: true,
        },
        {
          id: "response-2",
          data: { "ranking-q1": ["Item 2", "Item 1", "Item 3"] },
          updatedAt: new Date(),
          contact: null,
          contactAttributes: {},
          language: null,
          ttc: {},
          finished: true,
        },
      ];

      const dropOff = [
        { elementId: "ranking-q1", impressions: 2, dropOffCount: 0, dropOffPercentage: 0 },
      ] as unknown as TSurveySummary["dropOff"];

      const summary = await getElementSummary(
        survey,
        getElementsFromBlocks(survey.blocks),
        responses,
        dropOff
      );

      expect(summary).toHaveLength(1);
      expect(summary[0].type).toBe(TSurveyElementTypeEnum.Ranking);
      expect(summary[0].responseCount).toBe(2);
      expect((summary[0] as any).choices).toHaveLength(3);

      // Item 1 is in position 1 once and position 2 once, so avg ranking should be (1+2)/2 = 1.5
      const item1 = (summary[0] as any).choices.find((c) => c.value === "Item 1");
      expect(item1.count).toBe(2);
      expect(item1.avgRanking).toBe(1.5);

      // Item 2 is in position 1 once and position 2 once, so avg ranking should be (1+2)/2 = 1.5
      const item2 = (summary[0] as any).choices.find((c) => c.value === "Item 2");
      expect(item2.count).toBe(2);
      expect(item2.avgRanking).toBe(1.5);

      // Item 3 is in position 3 twice, so avg ranking should be 3
      const item3 = (summary[0] as any).choices.find((c) => c.value === "Item 3");
      expect(item3.count).toBe(2);
      expect(item3.avgRanking).toBe(3);
    });

    test("getQuestionSummary correctly processes ranking question with non-default language responses", async () => {
      const question = {
        id: "ranking-q1",
        type: TSurveyElementTypeEnum.Ranking,
        headline: { default: "Rank these items", es: "Clasifica estos elementos" },
        required: true,
        choices: [
          { id: "item1", label: { default: "Item 1", es: "Elemento 1" } },
          { id: "item2", label: { default: "Item 2", es: "Elemento 2" } },
          { id: "item3", label: { default: "Item 3", es: "Elemento 3" } },
        ],
      };

      const survey = {
        id: "survey-1",
        blocks: [
          {
            id: "block1",
            name: "Block 1",
            elements: [question],
          },
        ],
        questions: [],
        languages: [{ language: { code: "es" }, default: false }],
        welcomeCard: { enabled: false },
      } as unknown as TSurvey;

      // Spanish response with Spanish labels
      const responses = [
        {
          id: "response-1",
          data: { "ranking-q1": ["Elemento 2", "Elemento 1", "Elemento 3"] },
          updatedAt: new Date(),
          contact: null,
          contactAttributes: {},
          language: "es",
          ttc: {},
          finished: true,
        },
      ];

      // Mock checkForI18n for this test case
      vi.mock("./surveySummary", async (importOriginal) => {
        const originalModule = await importOriginal();
        return {
          ...(originalModule as object),
          checkForI18n: vi.fn().mockImplementation(() => {
            // NOSONAR
            // Convert Spanish labels to default language labels
            return ["Item 2", "Item 1", "Item 3"];
          }),
        };
      });

      const dropOff = [
        { elementId: "ranking-q1", impressions: 1, dropOffCount: 0, dropOffPercentage: 0 },
      ] as unknown as TSurveySummary["dropOff"];

      const summary = await getElementSummary(
        survey,
        getElementsFromBlocks(survey.blocks),
        responses,
        dropOff
      );

      expect(summary).toHaveLength(1);
      expect(summary[0].type).toBe(TSurveyElementTypeEnum.Ranking);
      expect(summary[0].responseCount).toBe(1);

      // Item 1 is in position 2, so avg ranking should be 2
      const item1 = (summary[0] as any).choices.find((c) => c.value === "Item 1");
      expect(item1.count).toBe(1);
      expect(item1.avgRanking).toBe(2);

      // Item 2 is in position 1, so avg ranking should be 1
      const item2 = (summary[0] as any).choices.find((c) => c.value === "Item 2");
      expect(item2.count).toBe(1);
      expect(item2.avgRanking).toBe(1);

      // Item 3 is in position 3, so avg ranking should be 3
      const item3 = (summary[0] as any).choices.find((c) => c.value === "Item 3");
      expect(item3.count).toBe(1);
      expect(item3.avgRanking).toBe(3);
    });

    test("getQuestionSummary handles ranking question with no ranking data in responses", async () => {
      const question = {
        id: "ranking-q1",
        type: TSurveyElementTypeEnum.Ranking,
        headline: { default: "Rank these items" },
        required: false,
        choices: [
          { id: "item1", label: { default: "Item 1" } },
          { id: "item2", label: { default: "Item 2" } },
          { id: "item3", label: { default: "Item 3" } },
        ],
      };

      const survey = {
        id: "survey-1",
        blocks: [
          {
            id: "block1",
            name: "Block 1",
            elements: [question],
          },
        ],
        questions: [],
        languages: [],
        welcomeCard: { enabled: false },
      } as unknown as TSurvey;

      // Responses without any ranking data
      const responses = [
        {
          id: "response-1",
          data: {}, // No ranking data
          updatedAt: new Date(),
          contact: null,
          contactAttributes: {},
          language: null,
          ttc: {},
          finished: true,
        } as any,
        {
          id: "response-2",
          data: { "other-q": "some value" }, // No ranking data
          updatedAt: new Date(),
          contact: null,
          contactAttributes: {},
          language: null,
          ttc: {},
          finished: true,
        } as any,
      ];

      const dropOff = [
        { elementId: "ranking-q1", impressions: 2, dropOffCount: 2, dropOffPercentage: 100 },
      ] as unknown as TSurveySummary["dropOff"];

      const summary = await getElementSummary(
        survey,
        getElementsFromBlocks(survey.blocks),
        responses,
        dropOff
      );

      expect(summary).toHaveLength(1);
      expect(summary[0].type).toBe(TSurveyElementTypeEnum.Ranking);
      expect(summary[0].responseCount).toBe(0);
      expect((summary[0] as any).choices).toHaveLength(3);

      // All items should have count 0 and avgRanking 0
      (summary[0] as any).choices.forEach((choice) => {
        expect(choice.count).toBe(0);
        expect(choice.avgRanking).toBe(0);
      });
    });

    test("getQuestionSummary handles ranking question with non-array answers", async () => {
      const question = {
        id: "ranking-q1",
        type: TSurveyElementTypeEnum.Ranking,
        headline: { default: "Rank these items" },
        required: true,
        choices: [
          { id: "item1", label: { default: "Item 1" } },
          { id: "item2", label: { default: "Item 2" } },
          { id: "item3", label: { default: "Item 3" } },
        ],
      };

      const survey = {
        id: "survey-1",
        blocks: [
          {
            id: "block1",
            name: "Block 1",
            elements: [question],
          },
        ],
        questions: [],
        languages: [],
        welcomeCard: { enabled: false },
      } as unknown as TSurvey;

      // Responses with invalid ranking data (not an array)
      const responses = [
        {
          id: "response-1",
          data: { "ranking-q1": "Item 1" }, // Not an array
          updatedAt: new Date(),
          contact: null,
          contactAttributes: {},
          language: null,
          ttc: {},
          finished: true,
        },
      ];

      const dropOff = [
        { elementId: "ranking-q1", impressions: 1, dropOffCount: 0, dropOffPercentage: 0 },
      ] as unknown as TSurveySummary["dropOff"];

      const summary = await getElementSummary(
        survey,
        getElementsFromBlocks(survey.blocks),
        responses,
        dropOff
      );

      expect(summary).toHaveLength(1);
      expect(summary[0].type).toBe(TSurveyElementTypeEnum.Ranking);
      expect(summary[0].responseCount).toBe(0); // No valid responses
      expect((summary[0] as any).choices).toHaveLength(3);

      // All items should have count 0 and avgRanking 0 since we had no valid ranking data
      (summary[0] as any).choices.forEach((choice) => {
        expect(choice.count).toBe(0);
        expect(choice.avgRanking).toBe(0);
      });
    });

    test("getQuestionSummary handles ranking question with values not in choices", async () => {
      const question = {
        id: "ranking-q1",
        type: TSurveyElementTypeEnum.Ranking,
        headline: { default: "Rank these items" },
        required: true,
        choices: [
          { id: "item1", label: { default: "Item 1" } },
          { id: "item2", label: { default: "Item 2" } },
          { id: "item3", label: { default: "Item 3" } },
        ],
      };

      const survey = {
        id: "survey-1",
        blocks: [
          {
            id: "block1",
            name: "Block 1",
            elements: [question],
          },
        ],
        questions: [],
        languages: [],
        welcomeCard: { enabled: false },
      } as unknown as TSurvey;

      // Response with some values not in choices
      const responses = [
        {
          id: "response-1",
          data: { "ranking-q1": ["Item 1", "Unknown Item", "Item 3"] }, // "Unknown Item" is not in choices
          updatedAt: new Date(),
          contact: null,
          contactAttributes: {},
          language: null,
          ttc: {},
          finished: true,
        },
      ];

      const dropOff = [
        { elementId: "ranking-q1", impressions: 1, dropOffCount: 0, dropOffPercentage: 0 },
      ] as unknown as TSurveySummary["dropOff"];

      const summary = await getElementSummary(
        survey,
        getElementsFromBlocks(survey.blocks),
        responses,
        dropOff
      );

      expect(summary).toHaveLength(1);
      expect(summary[0].type).toBe(TSurveyElementTypeEnum.Ranking);
      expect(summary[0].responseCount).toBe(1);
      expect((summary[0] as any).choices).toHaveLength(3);

      // Item 1 is in position 1, so avg ranking should be 1
      const item1 = (summary[0] as any).choices.find((c) => c.value === "Item 1");
      expect(item1.count).toBe(1);
      expect(item1.avgRanking).toBe(1);

      // Item 2 was not ranked, so should have count 0 and avgRanking 0
      const item2 = (summary[0] as any).choices.find((c) => c.value === "Item 2");
      expect(item2.count).toBe(0);
      expect(item2.avgRanking).toBe(0);

      // Item 3 is in position 3, so avg ranking should be 3
      const item3 = (summary[0] as any).choices.find((c) => c.value === "Item 3");
      expect(item3.count).toBe(1);
      expect(item3.avgRanking).toBe(3);
    });
  });
});

describe("getSurveySummary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default mocks for services
    vi.mocked(getSurvey).mockResolvedValue(mockBaseSurvey);
    vi.mocked(getResponseCountBySurveyId).mockResolvedValue(mockResponses.length);
    vi.mocked(getQuotasSummary).mockResolvedValue(mockQuotas);
    // For getResponsesForSummary mock, we need to ensure it's correctly used by getSurveySummary
    // Since getSurveySummary calls getResponsesForSummary internally, we'll mock prisma.response.findMany
    // which is used by the actual implementation of getResponsesForSummary.
    vi.mocked(prisma.response.findMany).mockResolvedValue(
      mockResponses.map((r) => ({ ...r, contactId: null, personAttributes: {} })) as any
    );
    vi.mocked(getDisplayCountBySurveyId).mockResolvedValue(10);

    // Mock internal function calls if they are complex, otherwise let them run with mocked data
    // For simplicity, we can assume getSurveySummaryDropOff and getQuestionSummary are tested independently
    // and will work correctly if their inputs (survey, responses, displayCount) are correct.
    // Or, provide simplified mocks for them if needed.
    vi.mocked(getLocalizedValue).mockImplementation((val, _) => val?.default || "");
    vi.mocked(convertFloatTo2Decimal).mockImplementation((num) =>
      num !== undefined && num !== null ? parseFloat(num.toFixed(2)) : 0
    );
    // React cache is already mocked globally - no need to mock it again
  });

  test("returns survey summary successfully", async () => {
    const summary = await getSurveySummary(mockSurveyId);
    expect(summary.meta.totalResponses).toBe(mockResponses.length);
    expect(summary.meta.displayCount).toBe(10);
    expect(summary.dropOff).toBeDefined();
    expect(summary.summary).toBeDefined();
    expect(getSurvey).toHaveBeenCalledWith(mockSurveyId);
    expect(prisma.response.findMany).toHaveBeenCalled(); // Check if getResponsesForSummary was effectively called
    expect(getDisplayCountBySurveyId).toHaveBeenCalled();
  });

  test("throws ResourceNotFoundError if survey not found", async () => {
    vi.mocked(getSurvey).mockResolvedValue(null);
    await expect(getSurveySummary(mockSurveyId)).rejects.toThrow(ResourceNotFoundError);
  });

  test("handles filterCriteria", async () => {
    const filterCriteria: TResponseFilterCriteria = { finished: true };
    const finishedResponses = mockResponses
      .filter((r) => r.finished)
      .map((r) => ({ ...r, contactId: null, personAttributes: {} }));
    vi.mocked(prisma.response.findMany).mockResolvedValue(finishedResponses as any);

    await getSurveySummary(mockSurveyId, filterCriteria);

    expect(prisma.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ surveyId: mockSurveyId }), // buildWhereClause is mocked
      })
    );
    expect(getDisplayCountBySurveyId).toHaveBeenCalledWith(
      mockSurveyId,
      expect.objectContaining({ responseIds: expect.any(Array) })
    );
  });
});

describe("getResponsesForSummary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSurvey).mockResolvedValue(mockBaseSurvey);
    vi.mocked(prisma.response.findMany).mockResolvedValue(
      mockResponses.map((r) => ({ ...r, contactId: null, personAttributes: {} })) as any
    );
    // React cache is already mocked globally - no need to mock it again
  });

  test("fetches and transforms responses", async () => {
    const limit = 2;
    const offset = 0;
    const result = await getResponsesForSummary(mockSurveyId, limit, offset);

    expect(getSurvey).toHaveBeenCalledWith(mockSurveyId);
    expect(prisma.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: limit,
        skip: offset,
        where: { surveyId: mockSurveyId }, // buildWhereClause is mocked to return {}
      })
    );
    expect(result.length).toBe(mockResponses.length); // Mock returns all, actual would be limited by prisma
    expect(result[0].id).toBe(mockResponses[0].id);
    expect(result[0].contact).toBeNull(); // As per transformation logic
  });

  test("returns empty array if survey not found", async () => {
    vi.mocked(getSurvey).mockResolvedValue(null);
    const result = await getResponsesForSummary(mockSurveyId, 10, 0);
    expect(result).toEqual([]);
  });

  test("throws DatabaseError on prisma failure", async () => {
    vi.mocked(prisma.response.findMany).mockRejectedValue(new Error("DB error"));
    await expect(getResponsesForSummary(mockSurveyId, 10, 0)).rejects.toThrow("DB error");
  });

  test("getResponsesForSummary handles null contact properly", async () => {
    const mockSurvey = { id: "survey-1" } as unknown as TSurvey;
    const mockResponse = {
      id: "response-1",
      data: {},
      updatedAt: new Date(),
      contact: null,
      contactAttributes: {},
      language: "en",
      ttc: {},
      finished: true,
      createdAt: new Date(),
      meta: {},
      variables: {},
      surveyId: "survey-1",
      contactId: null,
      personAttributes: {},
      singleUseId: null,
      isFinished: true,
      displayId: "display-1",
      endingId: null,
    };

    vi.mocked(getSurvey).mockResolvedValue(mockSurvey);
    vi.mocked(prisma.response.findMany).mockResolvedValue([mockResponse]);

    const result = await getResponsesForSummary("survey-1", 10, 0);

    expect(result).toHaveLength(1);
    expect(result[0].contact).toBeNull();
    expect(prisma.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { surveyId: "survey-1" },
      })
    );
  });

  test("getResponsesForSummary extracts contact id and userId when contact exists", async () => {
    const mockSurvey = { id: "survey-1" } as unknown as TSurvey;
    const mockResponse = {
      id: "response-1",
      data: {},
      updatedAt: new Date(),
      contact: {
        id: "contact-1",
        attributes: [
          { attributeKey: { key: "userId" }, value: "user-123" },
          { attributeKey: { key: "email" }, value: "test@example.com" },
        ],
      },
      contactAttributes: {},
      language: "en",
      ttc: {},
      finished: true,
      createdAt: new Date(),
      meta: {},
      variables: {},
      surveyId: "survey-1",
      contactId: "contact-1",
      personAttributes: {},
      singleUseId: null,
      isFinished: true,
      displayId: "display-1",
      endingId: null,
    };

    vi.mocked(getSurvey).mockResolvedValue(mockSurvey);
    vi.mocked(prisma.response.findMany).mockResolvedValue([mockResponse]);

    const result = await getResponsesForSummary("survey-1", 10, 0);

    expect(result).toHaveLength(1);
    expect(result[0].contact).toEqual({
      id: "contact-1",
      userId: "user-123",
    });
  });

  test("getResponsesForSummary handles contact without userId attribute", async () => {
    const mockSurvey = { id: "survey-1" } as unknown as TSurvey;
    const mockResponse = {
      id: "response-1",
      data: {},
      updatedAt: new Date(),
      contact: {
        id: "contact-1",
        attributes: [{ attributeKey: { key: "email" }, value: "test@example.com" }],
      },
      contactAttributes: {},
      language: "en",
      ttc: {},
      finished: true,
      createdAt: new Date(),
      meta: {},
      variables: {},
      surveyId: "survey-1",
      contactId: "contact-1",
      personAttributes: {},
      singleUseId: null,
      isFinished: true,
      displayId: "display-1",
      endingId: null,
    };

    vi.mocked(getSurvey).mockResolvedValue(mockSurvey);
    vi.mocked(prisma.response.findMany).mockResolvedValue([mockResponse]);

    const result = await getResponsesForSummary("survey-1", 10, 0);

    expect(result).toHaveLength(1);
    expect(result[0].contact).toEqual({
      id: "contact-1",
      userId: undefined,
    });
  });

  test("getResponsesForSummary throws DatabaseError when Prisma throws PrismaClientKnownRequestError", async () => {
    vi.mocked(getSurvey).mockResolvedValue({ id: "survey-1" } as unknown as TSurvey);

    const prismaError = new Prisma.PrismaClientKnownRequestError("Database connection error", {
      code: "P2002",
      clientVersion: "4.0.0",
    });

    vi.mocked(prisma.response.findMany).mockRejectedValue(prismaError);

    await expect(getResponsesForSummary("survey-1", 10, 0)).rejects.toThrow(DatabaseError);
    await expect(getResponsesForSummary("survey-1", 10, 0)).rejects.toThrow("Database connection error");
  });

  test("getResponsesForSummary rethrows non-Prisma errors", async () => {
    vi.mocked(getSurvey).mockResolvedValue({ id: "survey-1" } as unknown as TSurvey);

    const genericError = new Error("Something else went wrong");
    vi.mocked(prisma.response.findMany).mockRejectedValue(genericError);

    await expect(getResponsesForSummary("survey-1", 10, 0)).rejects.toThrow("Something else went wrong");
    await expect(getResponsesForSummary("survey-1", 10, 0)).rejects.toThrow(Error);
    await expect(getResponsesForSummary("survey-1", 10, 0)).rejects.not.toThrow(DatabaseError);
  });

  test("getSurveySummary throws DatabaseError when Prisma throws PrismaClientKnownRequestError from getDisplayCountBySurveyId", async () => {
    vi.mocked(getSurvey).mockResolvedValue({
      id: "survey-1",
      blocks: [],
      questions: [],
      welcomeCard: { enabled: false } as unknown as TSurvey["welcomeCard"],
      languages: [],
    } as unknown as TSurvey);

    // Mock prisma.response.findMany to return empty array so getResponsesForSummary succeeds
    vi.mocked(prisma.response.findMany).mockResolvedValue([]);

    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "Database connection error from display count",
      {
        code: "P2002",
        clientVersion: "4.0.0",
      }
    );

    // Throw Prisma error from getDisplayCountBySurveyId to hit getSurveySummary's catch block
    vi.mocked(getDisplayCountBySurveyId).mockRejectedValue(prismaError);

    await expect(getSurveySummary("survey-1")).rejects.toThrow(DatabaseError);
    await expect(getSurveySummary("survey-1")).rejects.toThrow(
      "Database connection error from display count"
    );
  });

  test("getSurveySummary rethrows non-Prisma errors from getDisplayCountBySurveyId", async () => {
    vi.mocked(getSurvey).mockResolvedValue({
      id: "survey-1",
      blocks: [],
      questions: [],
      welcomeCard: { enabled: false } as unknown as TSurvey["welcomeCard"],
      languages: [],
    } as unknown as TSurvey);

    // Mock prisma.response.findMany to return empty array so getResponsesForSummary succeeds
    vi.mocked(prisma.response.findMany).mockResolvedValue([]);

    const genericError = new Error("Something else went wrong");
    vi.mocked(getDisplayCountBySurveyId).mockRejectedValue(genericError);

    await expect(getSurveySummary("survey-1")).rejects.toThrow("Something else went wrong");
    await expect(getSurveySummary("survey-1")).rejects.toThrow(Error);
    await expect(getSurveySummary("survey-1")).rejects.not.toThrow(DatabaseError);
  });

  test("getSurveySummary handles multiple batches when responses exceed batchSize", async () => {
    vi.mocked(getSurvey).mockResolvedValue({
      id: "survey-1",
      blocks: [],
      questions: [],
      welcomeCard: { enabled: false } as unknown as TSurvey["welcomeCard"],
      languages: [],
    } as unknown as TSurvey);

    // Create mock responses for two batches
    // First batch: 5000 responses (exactly batchSize, triggers continuation)
    // Second batch: 100 responses (less than batchSize, stops loop)
    const createMockResponses = (count: number, startIdx: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `response-${startIdx + i}`,
        data: {},
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: "en",
        ttc: {},
        finished: true,
        createdAt: new Date(),
        meta: {},
        variables: {},
        surveyId: "survey-1",
        contactId: null,
        personAttributes: {},
        singleUseId: null,
        isFinished: true,
        displayId: "display-1",
        endingId: null,
      }));

    const firstBatch = createMockResponses(5000, 0);
    const secondBatch = createMockResponses(100, 5000);

    // First call returns 5000, second call returns 100
    vi.mocked(prisma.response.findMany).mockResolvedValueOnce(firstBatch).mockResolvedValueOnce(secondBatch);

    vi.mocked(getDisplayCountBySurveyId).mockResolvedValue(5100);
    vi.mocked(getQuotasSummary).mockResolvedValue([]);

    const result = await getSurveySummary("survey-1");

    // Verify that prisma.response.findMany was called twice (two batches)
    expect(prisma.response.findMany).toHaveBeenCalledTimes(2);

    // Second call should have cursor set to last response ID of first batch
    expect(prisma.response.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          surveyId: "survey-1",
          id: { lt: "response-4999" }, // Last ID from first batch
        }),
      })
    );

    // Result should contain data from all responses
    expect(result.meta.totalResponses).toBe(5100);
  });

  test("getResponsesForSummary applies cursor-based pagination when cursor is provided", async () => {
    const mockSurvey = { id: "survey-1" } as unknown as TSurvey;
    const mockResponse = {
      id: "response-2",
      data: {},
      updatedAt: new Date(),
      contact: null,
      contactAttributes: {},
      language: "en",
      ttc: {},
      finished: true,
      createdAt: new Date(),
      meta: {},
      variables: {},
      surveyId: "survey-1",
      contactId: null,
      personAttributes: {},
      singleUseId: null,
      isFinished: true,
      displayId: "display-1",
      endingId: null,
    };

    vi.mocked(getSurvey).mockResolvedValue(mockSurvey);
    vi.mocked(prisma.response.findMany).mockResolvedValue([mockResponse]);

    const result = await getResponsesForSummary("survey-1", 10, 0, undefined, "cursor-response-id");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("response-2");

    // Verify that prisma.response.findMany was called with cursor condition
    expect(prisma.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          surveyId: "survey-1",
          id: { lt: "cursor-response-id" },
        }),
      })
    );
  });
});

describe("Address and ContactInfo question types", () => {
  test("getQuestionSummary correctly processes Address question with valid responses", async () => {
    const question = {
      id: "address-q1",
      type: TSurveyElementTypeEnum.Address,
      headline: { default: "What's your address?" },
      required: true,
      fields: ["line1", "line2", "city", "state", "zip", "country"],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {
          "address-q1": [
            { type: "line1", value: "123 Main St" },
            { type: "city", value: "San Francisco" },
            { type: "state", value: "CA" },
          ],
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      } as any,
      {
        id: "response-2",
        data: {
          "address-q1": [
            { type: "line1", value: "456 Oak Ave" },
            { type: "city", value: "Seattle" },
            { type: "state", value: "WA" },
          ],
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      } as any,
    ];

    const dropOff = [
      { elementId: "address-q1", impressions: 2, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary = await getElementSummary(survey, getElementsFromBlocks(survey.blocks), responses, dropOff);

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Address);
    expect(summary[0].responseCount).toBe(2);
    expect((summary[0] as any).samples).toHaveLength(2);
    expect((summary[0] as any).samples[0].value).toEqual(responses[0].data["address-q1"]);
    expect((summary[0] as any).samples[1].value).toEqual(responses[1].data["address-q1"]);
  });

  test("getQuestionSummary correctly processes ContactInfo question with valid responses", async () => {
    const question = {
      id: "contact-q1",
      type: TSurveyElementTypeEnum.ContactInfo,
      headline: { default: "Your contact information" },
      required: true,
      fields: ["firstName", "lastName", "email", "phone"],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {
          "contact-q1": [
            { type: "firstName", value: "John" },
            { type: "lastName", value: "Doe" },
            { type: "email", value: "john@example.com" },
          ],
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: {
          "contact-q1": [
            { type: "firstName", value: "Jane" },
            { type: "lastName", value: "Smith" },
            { type: "email", value: "jane@example.com" },
          ],
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "contact-q1", impressions: 2, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary = await getElementSummary(survey, getElementsFromBlocks(survey.blocks), responses, dropOff);

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.ContactInfo);
    expect((summary[0] as any).responseCount).toBe(2);
    expect((summary[0] as any).samples).toHaveLength(2);
    expect((summary[0] as any).samples[0].value).toEqual(responses[0].data["contact-q1"]);
    expect((summary[0] as any).samples[1].value).toEqual(responses[1].data["contact-q1"]);
  });

  test("getQuestionSummary handles empty array answers for Address type", async () => {
    const question = {
      id: "address-q1",
      type: TSurveyElementTypeEnum.Address,
      headline: { default: "What's your address?" },
      required: false,
      fields: ["line1", "line2", "city", "state", "zip", "country"],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "address-q1": [] }, // Empty array
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "address-q1", impressions: 1, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary = await getElementSummary(survey, getElementsFromBlocks(survey.blocks), responses, dropOff);

    expect(summary).toHaveLength(1);
    expect((summary[0] as any).type).toBe(TSurveyElementTypeEnum.Address);
    expect((summary[0] as any).responseCount).toBe(0); // Should be 0 as empty array doesn't count as response
    expect((summary[0] as any).samples).toHaveLength(0);
  });

  test("getQuestionSummary handles non-array answers for ContactInfo type", async () => {
    const question = {
      id: "contact-q1",
      type: TSurveyElementTypeEnum.ContactInfo,
      headline: { default: "Your contact information" },
      required: true,
      fields: ["firstName", "lastName", "email", "phone"],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "contact-q1": "Not an array" }, // String instead of array
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: { "contact-q1": { name: "John" } }, // Object instead of array
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-3",
        data: {}, // No data for this question
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "contact-q1", impressions: 3, dropOffCount: 3, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary = await getElementSummary(survey, getElementsFromBlocks(survey.blocks), responses, dropOff);

    expect(summary).toHaveLength(1);
    expect((summary[0] as any).type).toBe(TSurveyElementTypeEnum.ContactInfo);
    expect((summary[0] as any).responseCount).toBe(0); // Should be 0 as no valid responses
    expect((summary[0] as any).samples).toHaveLength(0);
  });

  test("getQuestionSummary handles mix of valid and invalid responses for Address type", async () => {
    const question = {
      id: "address-q1",
      type: TSurveyElementTypeEnum.Address,
      headline: { default: "What's your address?" },
      required: true,
      fields: ["line1", "line2", "city", "state", "zip", "country"],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    // One valid response, one invalid
    const responses = [
      {
        id: "response-1",
        data: {
          "address-q1": [
            { type: "line1", value: "123 Main St" },
            { type: "city", value: "San Francisco" },
          ],
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: { "address-q1": "Invalid format" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "address-q1", impressions: 2, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary = await getElementSummary(survey, getElementsFromBlocks(survey.blocks), responses, dropOff);

    expect(summary).toHaveLength(1);
    expect((summary[0] as any).type).toBe(TSurveyElementTypeEnum.Address);
    expect((summary[0] as any).responseCount).toBe(1); // Should be 1 as only one valid response
    expect((summary[0] as any).samples).toHaveLength(1);
    expect((summary[0] as any).samples[0].value).toEqual(responses[0].data["address-q1"]);
  });

  test("getQuestionSummary applies VALUES_LIMIT correctly for ContactInfo type", async () => {
    const question = {
      id: "contact-q1",
      type: TSurveyElementTypeEnum.ContactInfo,
      headline: { default: "Your contact information" },
      required: true,
      fields: ["firstName", "lastName", "email"],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    // Create 100 responses (more than VALUES_LIMIT which is 50)
    const responses = Array.from(
      { length: 100 },
      (_, i) =>
        ({
          id: `response-${i}`,
          data: {
            "contact-q1": [
              { type: "firstName", value: `First${i}` },
              { type: "lastName", value: `Last${i}` },
              { type: "email", value: `user${i}@example.com` },
            ],
          },
          updatedAt: new Date(),
          contact: null,
          contactAttributes: {},
          language: null,
          ttc: {},
          finished: true,
        }) as any
    );

    const dropOff = [
      { elementId: "contact-q1", impressions: 100, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary = await getElementSummary(survey, getElementsFromBlocks(survey.blocks), responses, dropOff);

    expect(summary).toHaveLength(1);
    expect((summary[0] as any).type).toBe(TSurveyElementTypeEnum.ContactInfo);
    expect((summary[0] as any).responseCount).toBe(100); // All responses are valid
    expect((summary[0] as any).samples).toHaveLength(50); // Limited to VALUES_LIMIT (50)
  });
});

describe("Matrix question type tests", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getLocalizedValue).mockImplementation((val, _) => val?.default || "");
    vi.mocked(convertFloatTo2Decimal).mockImplementation((num) =>
      num !== undefined && num !== null ? parseFloat(num.toFixed(2)) : 0
    );
  });

  test("getQuestionSummary correctly processes Matrix question with valid responses", async () => {
    const question = {
      id: "matrix-q1",
      type: TSurveyElementTypeEnum.Matrix,
      headline: { default: "Rate these aspects" },
      required: true,
      rows: [
        { id: "row-1", label: { default: "Speed" } },
        { id: "row-2", label: { default: "Quality" } },
        { id: "row-3", label: { default: "Price" } },
      ],
      columns: [
        { id: "col-1", label: { default: "Poor" } },
        { id: "col-2", label: { default: "Average" } },
        { id: "col-3", label: { default: "Good" } },
        { id: "col-4", label: { default: "Excellent" } },
      ],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {
          "matrix-q1": {
            Speed: "Good",
            Quality: "Excellent",
            Price: "Average",
          },
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: {
          "matrix-q1": {
            Speed: "Average",
            Quality: "Good",
            Price: "Poor",
          },
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "matrix-q1", impressions: 2, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Matrix);
    expect(summary[0].responseCount).toBe(2);

    // Verify Speed row
    const speedRow = summary[0].data.find((row) => row.rowLabel === "Speed");
    expect(speedRow.totalResponsesForRow).toBe(2);
    expect(speedRow.columnPercentages).toHaveLength(4); // 4 columns
    expect(speedRow.columnPercentages.find((col) => col.column === "Good").percentage).toBe(50);
    expect(speedRow.columnPercentages.find((col) => col.column === "Average").percentage).toBe(50);

    // Verify Quality row
    const qualityRow = summary[0].data.find((row) => row.rowLabel === "Quality");
    expect(qualityRow.totalResponsesForRow).toBe(2);
    expect(qualityRow.columnPercentages.find((col) => col.column === "Excellent").percentage).toBe(50);
    expect(qualityRow.columnPercentages.find((col) => col.column === "Good").percentage).toBe(50);

    // Verify Price row
    const priceRow = summary[0].data.find((row) => row.rowLabel === "Price");
    expect(priceRow.totalResponsesForRow).toBe(2);
    expect(priceRow.columnPercentages.find((col) => col.column === "Poor").percentage).toBe(50);
    expect(priceRow.columnPercentages.find((col) => col.column === "Average").percentage).toBe(50);
  });

  test("getQuestionSummary correctly processes Matrix question with non-default language responses", async () => {
    const question = {
      id: "matrix-q1",
      type: TSurveyElementTypeEnum.Matrix,
      headline: { default: "Rate these aspects", es: "Califica estos aspectos" },
      required: true,
      rows: [
        { id: "row-1", label: { default: "Speed", es: "Velocidad" } },
        { id: "row-2", label: { default: "Quality", es: "Calidad" } },
        { id: "row-3", label: { default: "Price", es: "Precio" } },
      ],
      columns: [
        { id: "col-1", label: { default: "Poor", es: "Malo" } },
        { id: "col-2", label: { default: "Average", es: "Promedio" } },
        { id: "col-3", label: { default: "Good", es: "Bueno" } },
        { id: "col-4", label: { default: "Excellent", es: "Excelente" } },
      ],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [{ language: { code: "es" }, default: false }],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    // Spanish response with Spanish labels
    const responses = [
      {
        id: "response-1",
        data: {
          "matrix-q1": {
            Velocidad: "Bueno",
            Calidad: "Excelente",
            Precio: "Promedio",
          },
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: "es",
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "matrix-q1", impressions: 1, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    // Mock getLocalizedValue for this test
    const getLocalizedValueOriginal = getLocalizedValue;
    vi.mocked(getLocalizedValue).mockImplementation((obj, langCode) => {
      if (!obj) return "";

      if (langCode === "es" && typeof obj === "object" && "es" in obj) {
        return obj.es;
      }

      if (typeof obj === "object" && "default" in obj) {
        return obj.default;
      }

      return "";
    });

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    // Reset the mock after test
    vi.mocked(getLocalizedValue).mockImplementation(getLocalizedValueOriginal);

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Matrix);
    expect(summary[0].responseCount).toBe(1);

    // Verify Speed row with localized values mapped to default language
    const speedRow = summary[0].data.find((row) => row.rowLabel === "Speed");
    expect(speedRow.totalResponsesForRow).toBe(1);
    expect(speedRow.columnPercentages.find((col) => col.column === "Good").percentage).toBe(100);

    // Verify Quality row
    const qualityRow = summary[0].data.find((row) => row.rowLabel === "Quality");
    expect(qualityRow.totalResponsesForRow).toBe(1);
    expect(qualityRow.columnPercentages.find((col) => col.column === "Excellent").percentage).toBe(100);

    // Verify Price row
    const priceRow = summary[0].data.find((row) => row.rowLabel === "Price");
    expect(priceRow.totalResponsesForRow).toBe(1);
    expect(priceRow.columnPercentages.find((col) => col.column === "Average").percentage).toBe(100);
  });

  test("getQuestionSummary handles missing or invalid data for Matrix questions", async () => {
    const question = {
      id: "matrix-q1",
      type: TSurveyElementTypeEnum.Matrix,
      headline: { default: "Rate these aspects" },
      required: false,
      rows: [{ default: "Speed" }, { default: "Quality" }],
      columns: [{ default: "Poor" }, { default: "Good" }],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {}, // No matrix data
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: {
          "matrix-q1": "Not an object", // Invalid format - not an object
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-3",
        data: {
          "matrix-q1": {}, // Empty object
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-4",
        data: {
          "matrix-q1": {
            Speed: "Invalid", // Value not in columns
          },
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "matrix-q1", impressions: 4, dropOffCount: 4, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Matrix);
    expect(summary[0].responseCount).toBe(3); // Count is 3 because responses 2, 3, and 4 have the "matrix-q1" property

    // All rows should have zero responses for all columns
    summary[0].data.forEach((row) => {
      expect(row.totalResponsesForRow).toBe(0);
      row.columnPercentages.forEach((col) => {
        expect(col.percentage).toBe(0);
      });
    });
  });

  test("getQuestionSummary handles partial and incomplete matrix responses", async () => {
    const question = {
      id: "matrix-q1",
      type: TSurveyElementTypeEnum.Matrix,
      headline: { default: "Rate these aspects" },
      required: true,
      rows: [
        { id: "row-1", label: { default: "Speed" } },
        { id: "row-2", label: { default: "Quality" } },
        { id: "row-3", label: { default: "Price" } },
      ],
      columns: [
        { id: "col-1", label: { default: "Poor" } },
        { id: "col-2", label: { default: "Average" } },
        { id: "col-3", label: { default: "Good" } },
      ],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {
          "matrix-q1": {
            Speed: "Good",
            // Quality is missing
            Price: "Average",
          },
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: {
          "matrix-q1": {
            Speed: "Average",
            Quality: "Good",
            Price: "Poor",
            ExtraRow: "Poor", // Row not in question definition
          },
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "matrix-q1", impressions: 2, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Matrix);
    expect(summary[0].responseCount).toBe(2);

    // Verify Speed row - both responses provided data
    const speedRow = summary[0].data.find((row) => row.rowLabel === "Speed");
    expect(speedRow.totalResponsesForRow).toBe(2);
    expect(speedRow.columnPercentages.find((col) => col.column === "Good").percentage).toBe(50);
    expect(speedRow.columnPercentages.find((col) => col.column === "Average").percentage).toBe(50);

    // Verify Quality row - only one response provided data
    const qualityRow = summary[0].data.find((row) => row.rowLabel === "Quality");
    expect(qualityRow.totalResponsesForRow).toBe(1);
    expect(qualityRow.columnPercentages.find((col) => col.column === "Good").percentage).toBe(100);

    // Verify Price row - both responses provided data
    const priceRow = summary[0].data.find((row) => row.rowLabel === "Price");
    expect(priceRow.totalResponsesForRow).toBe(2);

    // ExtraRow should not appear in the summary
    expect(summary[0].data.find((row) => row.rowLabel === "ExtraRow")).toBeUndefined();
  });

  test("getQuestionSummary handles zero responses for Matrix question correctly", async () => {
    const question = {
      id: "matrix-q1",
      type: TSurveyElementTypeEnum.Matrix,
      headline: { default: "Rate these aspects" },
      required: true,
      rows: [{ default: "Speed" }, { default: "Quality" }],
      columns: [{ default: "Poor" }, { default: "Good" }],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    // No responses with matrix data
    const responses = [
      {
        id: "response-1",
        data: { "other-question": "value" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "matrix-q1", impressions: 1, dropOffCount: 1, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Matrix);
    expect(summary[0].responseCount).toBe(0);

    // All rows should have proper structure but zero counts
    expect(summary[0].data).toHaveLength(2); // 2 rows

    summary[0].data.forEach((row) => {
      expect(row.columnPercentages).toHaveLength(2); // 2 columns
      expect(row.totalResponsesForRow).toBe(0);
      expect(row.columnPercentages[0].percentage).toBe(0);
      expect(row.columnPercentages[1].percentage).toBe(0);
    });
  });

  test("getQuestionSummary handles Matrix question with mixed valid and invalid column values", async () => {
    const question = {
      id: "matrix-q1",
      type: TSurveyElementTypeEnum.Matrix,
      headline: { default: "Rate these aspects" },
      required: true,
      rows: [
        { id: "row-1", label: { default: "Speed" } },
        { id: "row-2", label: { default: "Quality" } },
        { id: "row-3", label: { default: "Price" } },
      ],
      columns: [
        { id: "col-1", label: { default: "Poor" } },
        { id: "col-2", label: { default: "Average" } },
        { id: "col-3", label: { default: "Good" } },
      ],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {
          "matrix-q1": {
            Speed: "Good", // Valid
            Quality: "Invalid Column", // Invalid
            Price: "Average", // Valid
          },
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "matrix-q1", impressions: 1, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Matrix);
    expect(summary[0].responseCount).toBe(1);

    // Speed row should have a valid response
    const speedRow = summary[0].data.find((row) => row.rowLabel === "Speed");
    expect(speedRow.totalResponsesForRow).toBe(1);
    expect(speedRow.columnPercentages.find((col) => col.column === "Good").percentage).toBe(100);

    // Quality row should have no valid responses
    const qualityRow = summary[0].data.find((row) => row.rowLabel === "Quality");
    expect(qualityRow.totalResponsesForRow).toBe(0);
    qualityRow.columnPercentages.forEach((col) => {
      expect(col.percentage).toBe(0);
    });

    // Price row should have a valid response
    const priceRow = summary[0].data.find((row) => row.rowLabel === "Price");
    expect(priceRow.totalResponsesForRow).toBe(1);
    expect(priceRow.columnPercentages.find((col) => col.column === "Average").percentage).toBe(100);
  });

  test("getQuestionSummary handles Matrix question with invalid row labels", async () => {
    const question = {
      id: "matrix-q1",
      type: TSurveyElementTypeEnum.Matrix,
      headline: { default: "Rate these aspects" },
      required: true,
      rows: [
        { id: "row-1", label: { default: "Speed" } },
        { id: "row-2", label: { default: "Quality" } },
      ],
      columns: [
        { id: "col-1", label: { default: "Poor" } },
        { id: "col-2", label: { default: "Good" } },
      ],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {
          "matrix-q1": {
            Speed: "Good", // Valid
            InvalidRow: "Poor", // Invalid row
            AnotherInvalidRow: "Good", // Invalid row
          },
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "matrix-q1", impressions: 1, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Matrix);
    expect(summary[0].responseCount).toBe(1);

    // There should only be rows for the defined question rows
    expect(summary[0].data).toHaveLength(2); // 2 rows

    // Speed row should have a valid response
    const speedRow = summary[0].data.find((row) => row.rowLabel === "Speed");
    expect(speedRow.totalResponsesForRow).toBe(1);
    expect(speedRow.columnPercentages.find((col) => col.column === "Good").percentage).toBe(100);

    // Quality row should have no responses
    const qualityRow = summary[0].data.find((row) => row.rowLabel === "Quality");
    expect(qualityRow.totalResponsesForRow).toBe(0);

    // Invalid rows should not appear in the summary
    expect(summary[0].data.find((row) => row.rowLabel === "InvalidRow")).toBeUndefined();
    expect(summary[0].data.find((row) => row.rowLabel === "AnotherInvalidRow")).toBeUndefined();
  });

  test("getQuestionSummary handles Matrix question with mixed language responses", async () => {
    const question = {
      id: "matrix-q1",
      type: TSurveyElementTypeEnum.Matrix,
      headline: { default: "Rate these aspects", fr: "Évaluez ces aspects" },
      required: true,
      rows: [
        { id: "row-1", label: { default: "Speed", fr: "Vitesse" } },
        { id: "row-2", label: { default: "Quality", fr: "Qualité" } },
      ],
      columns: [
        { id: "col-1", label: { default: "Poor", fr: "Médiocre" } },
        { id: "col-2", label: { default: "Good", fr: "Bon" } },
      ],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [
        { language: { code: "en" }, default: true },
        { language: { code: "fr" }, default: false },
      ],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {
          "matrix-q1": {
            Speed: "Good", // English
          },
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: "en",
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: {
          "matrix-q1": {
            Vitesse: "Bon", // French
          },
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: "fr",
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "matrix-q1", impressions: 2, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    // Mock getLocalizedValue to handle our specific test case
    const originalGetLocalizedValue = getLocalizedValue;
    vi.mocked(getLocalizedValue).mockImplementation((obj, langCode) => {
      if (!obj) return "";

      if (langCode === "fr" && typeof obj === "object" && "fr" in obj) {
        return obj.fr;
      }

      if (typeof obj === "object" && "default" in obj) {
        return obj.default;
      }

      return "";
    });

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    // Reset mock
    vi.mocked(getLocalizedValue).mockImplementation(originalGetLocalizedValue);

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Matrix);
    expect(summary[0].responseCount).toBe(2);

    // Speed row should have both responses
    const speedRow = summary[0].data.find((row) => row.rowLabel === "Speed");
    expect(speedRow.totalResponsesForRow).toBe(2);
    expect(speedRow.columnPercentages.find((col) => col.column === "Good").percentage).toBe(100);

    // Quality row should have no responses
    const qualityRow = summary[0].data.find((row) => row.rowLabel === "Quality");
    expect(qualityRow.totalResponsesForRow).toBe(0);
  });

  test("getQuestionSummary handles Matrix question with null response data", async () => {
    const question = {
      id: "matrix-q1",
      type: TSurveyElementTypeEnum.Matrix,
      headline: { default: "Rate these aspects" },
      required: true,
      rows: [{ default: "Speed" }, { default: "Quality" }],
      columns: [{ default: "Poor" }, { default: "Good" }],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {
          "matrix-q1": null, // Null response data
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "matrix-q1", impressions: 1, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Matrix);
    expect(summary[0].responseCount).toBe(0); // Counts as response even with null data

    // Both rows should have zero responses
    summary[0].data.forEach((row) => {
      expect(row.totalResponsesForRow).toBe(0);
      row.columnPercentages.forEach((col) => {
        expect(col.percentage).toBe(0);
      });
    });
  });
});

describe("NPS question type tests", () => {
  test("getQuestionSummary correctly processes NPS question with valid responses", async () => {
    const question = {
      id: "nps-q1",
      type: TSurveyElementTypeEnum.NPS,
      headline: { default: "How likely are you to recommend us?" },
      required: true,
      lowerLabel: { default: "Not likely" },
      upperLabel: { default: "Very likely" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "nps-q1": 10 }, // Promoter (9-10)
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: { "nps-q1": 7 }, // Passive (7-8)
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-3",
        data: { "nps-q1": 3 }, // Detractor (0-6)
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-4",
        data: { "nps-q1": 9 }, // Promoter (9-10)
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "nps-q1", impressions: 4, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.NPS);
    expect(summary[0].responseCount).toBe(4);

    // NPS score = (promoters - detractors) / total * 100
    // Promoters: 2, Detractors: 1, Total: 4
    // (2 - 1) / 4 * 100 = 25
    expect(summary[0].score).toBe(25);

    // Verify promoters
    expect(summary[0].promoters.count).toBe(2);
    expect(summary[0].promoters.percentage).toBe(50); // 2/4 * 100

    // Verify passives
    expect(summary[0].passives.count).toBe(1);
    expect(summary[0].passives.percentage).toBe(25); // 1/4 * 100

    // Verify detractors
    expect(summary[0].detractors.count).toBe(1);
    expect(summary[0].detractors.percentage).toBe(25); // 1/4 * 100

    // Verify dismissed (none in this test)
    expect(summary[0].dismissed.count).toBe(0);
    expect(summary[0].dismissed.percentage).toBe(0);
  });

  test("getQuestionSummary handles NPS question with dismissed responses", async () => {
    const question = {
      id: "nps-q1",
      type: TSurveyElementTypeEnum.NPS,
      headline: { default: "How likely are you to recommend us?" },
      required: false,
      lowerLabel: { default: "Not likely" },
      upperLabel: { default: "Very likely" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "nps-q1": 10 }, // Promoter
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "nps-q1": 5 },
        finished: true,
      },
      {
        id: "response-2",
        data: {}, // No answer but has time tracking
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "nps-q1": 3 },
        finished: true,
      },
      {
        id: "response-3",
        data: {}, // No answer but has time tracking
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "nps-q1": 2 },
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "nps-q1", impressions: 3, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.NPS);
    expect(summary[0].responseCount).toBe(3);

    // NPS score = (promoters - detractors) / total * 100
    // Promoters: 1, Detractors: 0, Total: 3
    // (1 - 0) / 3 * 100 = 33.33
    expect(summary[0].score).toBe(33.33);

    // Verify promoters
    expect(summary[0].promoters.count).toBe(1);
    expect(summary[0].promoters.percentage).toBe(33.33); // 1/3 * 100

    // Verify dismissed
    expect(summary[0].dismissed.count).toBe(2);
    expect(summary[0].dismissed.percentage).toBe(66.67); // 2/3 * 100
  });

  test("getQuestionSummary handles NPS question with no responses", async () => {
    const question = {
      id: "nps-q1",
      type: TSurveyElementTypeEnum.NPS,
      headline: { default: "How likely are you to recommend us?" },
      required: true,
      lowerLabel: { default: "Not likely" },
      upperLabel: { default: "Very likely" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    // No responses with NPS data
    const responses = [
      {
        id: "response-1",
        data: { "other-q": "value" }, // No NPS data
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "nps-q1", impressions: 1, dropOffCount: 1, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.NPS);
    expect(summary[0].responseCount).toBe(0);
    expect(summary[0].score).toBe(0);

    expect(summary[0].promoters.count).toBe(0);
    expect(summary[0].promoters.percentage).toBe(0);

    expect(summary[0].passives.count).toBe(0);
    expect(summary[0].passives.percentage).toBe(0);

    expect(summary[0].detractors.count).toBe(0);
    expect(summary[0].detractors.percentage).toBe(0);

    expect(summary[0].dismissed.count).toBe(0);
    expect(summary[0].dismissed.percentage).toBe(0);
  });

  test("getQuestionSummary handles NPS question with invalid values", async () => {
    const question = {
      id: "nps-q1",
      type: TSurveyElementTypeEnum.NPS,
      headline: { default: "How likely are you to recommend us?" },
      required: true,
      lowerLabel: { default: "Not likely" },
      upperLabel: { default: "Very likely" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "nps-q1": "invalid" }, // String instead of number
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: { "nps-q1": null }, // Null value
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-3",
        data: { "nps-q1": 5 }, // Valid detractor
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "nps-q1", impressions: 3, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.NPS);
    expect(summary[0].responseCount).toBe(1); // Only one valid response

    // Only one valid response is a detractor
    expect(summary[0].detractors.count).toBe(1);
    expect(summary[0].detractors.percentage).toBe(100);

    // Score should be -100 since all valid responses are detractors
    expect(summary[0].score).toBe(-100);
  });
});

describe("Rating question type tests", () => {
  test("getQuestionSummary correctly processes Rating question with valid responses", async () => {
    const question = {
      id: "rating-q1",
      type: TSurveyElementTypeEnum.Rating,
      headline: { default: "How would you rate our service?" },
      required: true,
      scale: "number",
      range: 5, // 1-5 rating
      lowerLabel: { default: "Poor" },
      upperLabel: { default: "Excellent" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "rating-q1": 5 }, // Highest rating
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: { "rating-q1": 4 },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-3",
        data: { "rating-q1": 3 },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-4",
        data: { "rating-q1": 5 }, // Another highest rating
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "rating-q1", impressions: 4, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Rating);
    expect(summary[0].responseCount).toBe(4);

    // Average rating = (5 + 4 + 3 + 5) / 4 = 4.25
    expect(summary[0].average).toBe(4.25);

    // Verify each rating option count and percentage
    const rating5 = summary[0].choices.find((c) => c.rating === 5);
    expect(rating5.count).toBe(2);
    expect(rating5.percentage).toBe(50); // 2/4 * 100

    const rating4 = summary[0].choices.find((c) => c.rating === 4);
    expect(rating4.count).toBe(1);
    expect(rating4.percentage).toBe(25); // 1/4 * 100

    const rating3 = summary[0].choices.find((c) => c.rating === 3);
    expect(rating3.count).toBe(1);
    expect(rating3.percentage).toBe(25); // 1/4 * 100

    const rating2 = summary[0].choices.find((c) => c.rating === 2);
    expect(rating2.count).toBe(0);
    expect(rating2.percentage).toBe(0);

    const rating1 = summary[0].choices.find((c) => c.rating === 1);
    expect(rating1.count).toBe(0);
    expect(rating1.percentage).toBe(0);

    // Verify dismissed (none in this test)
    expect(summary[0].dismissed.count).toBe(0);
  });

  test("getQuestionSummary handles Rating question with dismissed responses", async () => {
    const question = {
      id: "rating-q1",
      type: TSurveyElementTypeEnum.Rating,
      headline: { default: "How would you rate our service?" },
      required: false,
      scale: "number",
      range: 5,
      lowerLabel: { default: "Poor" },
      upperLabel: { default: "Excellent" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "rating-q1": 5 }, // Valid rating
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "rating-q1": 3 },
        finished: true,
      },
      {
        id: "response-2",
        data: {}, // No answer, but has time tracking
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "rating-q1": 2 },
        finished: true,
      },
      {
        id: "response-3",
        data: {}, // No answer, but has time tracking
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "rating-q1": 4 },
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "rating-q1", impressions: 3, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Rating);
    expect(summary[0].responseCount).toBe(1); // Only one valid rating
    expect(summary[0].average).toBe(5); // Average of the one valid rating

    // Verify dismissed count
    expect(summary[0].dismissed.count).toBe(2);
  });

  test("getQuestionSummary handles Rating question with no responses", async () => {
    const question = {
      id: "rating-q1",
      type: TSurveyElementTypeEnum.Rating,
      headline: { default: "How would you rate our service?" },
      required: true,
      scale: "number",
      range: 5,
      lowerLabel: { default: "Poor" },
      upperLabel: { default: "Excellent" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    // No responses with rating data
    const responses = [
      {
        id: "response-1",
        data: { "other-q": "value" }, // No rating data
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "rating-q1", impressions: 1, dropOffCount: 1, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Rating);
    expect(summary[0].responseCount).toBe(0);
    expect(summary[0].average).toBe(0);

    // Verify all ratings have 0 count and percentage
    summary[0].choices.forEach((choice) => {
      expect(choice.count).toBe(0);
      expect(choice.percentage).toBe(0);
    });

    // Verify dismissed is 0
    expect(summary[0].dismissed.count).toBe(0);
  });
});

describe("PictureSelection question type tests", () => {
  test("getQuestionSummary correctly processes PictureSelection with valid responses", async () => {
    const question = {
      id: "picture-q1",
      type: TSurveyElementTypeEnum.PictureSelection,
      headline: { default: "Select the images you like" },
      required: true,
      choices: [
        { id: "img1", imageUrl: "https://example.com/img1.jpg" },
        { id: "img2", imageUrl: "https://example.com/img2.jpg" },
        { id: "img3", imageUrl: "https://example.com/img3.jpg" },
      ],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "picture-q1": ["img1", "img3"] },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: { "picture-q1": ["img2"] },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "picture-q1", impressions: 2, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.PictureSelection);
    expect(summary[0].responseCount).toBe(2);
    expect(summary[0].selectionCount).toBe(3); // Total selections: img1, img2, img3

    // Check individual choice counts
    const img1 = summary[0].choices.find((c) => c.id === "img1");
    expect(img1.count).toBe(1);
    expect(img1.percentage).toBe(50);

    const img2 = summary[0].choices.find((c) => c.id === "img2");
    expect(img2.count).toBe(1);
    expect(img2.percentage).toBe(50);

    const img3 = summary[0].choices.find((c) => c.id === "img3");
    expect(img3.count).toBe(1);
    expect(img3.percentage).toBe(50);
  });

  test("getQuestionSummary handles PictureSelection with no valid responses", async () => {
    const question = {
      id: "picture-q1",
      type: TSurveyElementTypeEnum.PictureSelection,
      headline: { default: "Select the images you like" },
      required: true,
      choices: [
        { id: "img1", imageUrl: "https://example.com/img1.jpg" },
        { id: "img2", imageUrl: "https://example.com/img2.jpg" },
      ],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "picture-q1": "not-an-array" }, // Invalid format
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: {}, // No data
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "picture-q1", impressions: 2, dropOffCount: 2, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.PictureSelection);
    expect(summary[0].responseCount).toBe(0);
    expect(summary[0].selectionCount).toBe(0);

    // All choices should have zero count
    summary[0].choices.forEach((choice) => {
      expect(choice.count).toBe(0);
      expect(choice.percentage).toBe(0);
    });
  });

  test("getQuestionSummary handles PictureSelection with invalid choice ids", async () => {
    const question = {
      id: "picture-q1",
      type: TSurveyElementTypeEnum.PictureSelection,
      headline: { default: "Select the images you like" },
      required: true,
      choices: [
        { id: "img1", imageUrl: "https://example.com/img1.jpg" },
        { id: "img2", imageUrl: "https://example.com/img2.jpg" },
      ],
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "picture-q1": ["invalid-id", "img1"] }, // One valid, one invalid ID
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "picture-q1", impressions: 1, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.PictureSelection);
    expect(summary[0].responseCount).toBe(1);
    expect(summary[0].selectionCount).toBe(2); // Total selections including invalid one

    // img1 should be counted
    const img1 = summary[0].choices.find((c) => c.id === "img1");
    expect(img1.count).toBe(1);
    expect(img1.percentage).toBe(100);

    // img2 should not be counted
    const img2 = summary[0].choices.find((c) => c.id === "img2");
    expect(img2.count).toBe(0);
    expect(img2.percentage).toBe(0);

    // Invalid ID should not appear in choices
    expect(summary[0].choices.find((c) => c.id === "invalid-id")).toBeUndefined();
  });
});

describe("CTA question type tests", () => {
  test("getQuestionSummary correctly processes CTA with valid responses", async () => {
    const question = {
      id: "cta-q1",
      type: TSurveyElementTypeEnum.CTA,
      headline: { default: "Would you like to try our product?" },
      buttonLabel: { default: "Try Now" },
      buttonExternal: true,
      buttonUrl: "https://example.com",
      required: true,
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "cta-q1": "clicked" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: { "cta-q1": "dismissed" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-3",
        data: { "cta-q1": "clicked" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      {
        elementId: "cta-q1",
        impressions: 5, // 5 total impressions (including 2 that didn't respond)
        dropOffCount: 0,
        dropOffPercentage: 0,
      },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.CTA);
    expect(summary[0].responseCount).toBe(3);
    expect(summary[0].impressionCount).toBe(5);
    expect(summary[0].clickCount).toBe(2);
    expect(summary[0].skipCount).toBe(1);

    // CTR calculation: clicks / impressions * 100
    expect(summary[0].ctr.count).toBe(2);
    expect(summary[0].ctr.percentage).toBe(40); // (2/5)*100 = 40%
  });

  test("getQuestionSummary handles CTA with no responses", async () => {
    const question = {
      id: "cta-q1",
      type: TSurveyElementTypeEnum.CTA,
      headline: { default: "Would you like to try our product?" },
      buttonLabel: { default: "Try Now" },
      buttonExternal: true,
      buttonUrl: "https://example.com",
      required: false,
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {}, // No data
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      {
        elementId: "cta-q1",
        impressions: 3, // 3 total impressions
        dropOffCount: 3,
        dropOffPercentage: 100,
      },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.CTA);
    expect(summary[0].responseCount).toBe(0);
    expect(summary[0].impressionCount).toBe(3);
    expect(summary[0].clickCount).toBe(0);
    expect(summary[0].skipCount).toBe(0);

    expect(summary[0].ctr.count).toBe(0);
    expect(summary[0].ctr.percentage).toBe(0);
  });

  test("getQuestionSummary skips CTA summary when buttonExternal is false", async () => {
    const question = {
      id: "cta-q1",
      type: TSurveyElementTypeEnum.CTA,
      headline: { default: "Internal CTA" },
      buttonLabel: { default: "Continue" },
      buttonExternal: false, // Internal button - no CTR tracking
      required: false,
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "cta-q1": "clicked" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      {
        elementId: "cta-q1",
        impressions: 1,
        dropOffCount: 0,
        dropOffPercentage: 0,
      },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    // CTA with buttonExternal: false should not generate a summary
    expect(summary).toHaveLength(0);
  });
});

describe("Consent question type tests", () => {
  test("getQuestionSummary correctly processes Consent with valid responses", async () => {
    const question = {
      id: "consent-q1",
      type: TSurveyElementTypeEnum.Consent,
      headline: { default: "Do you consent to our terms?" },
      required: true,
      label: { default: "I agree to the terms" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "consent-q1": "accepted" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: {}, // Nothing, but time was spent so it's dismissed
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "consent-q1": 5 },
        finished: true,
      },
      {
        id: "response-3",
        data: { "consent-q1": "accepted" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "consent-q1", impressions: 3, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Consent);
    expect(summary[0].responseCount).toBe(3);

    // 2 accepted / 3 total = 66.67%
    expect(summary[0].accepted.count).toBe(2);
    expect(summary[0].accepted.percentage).toBe(66.67);

    // 1 dismissed / 3 total = 33.33%
    expect(summary[0].dismissed.count).toBe(1);
    expect(summary[0].dismissed.percentage).toBe(33.33);
  });

  test("getQuestionSummary handles Consent with no responses", async () => {
    const question = {
      id: "consent-q1",
      type: TSurveyElementTypeEnum.Consent,
      headline: { default: "Do you consent to our terms?" },
      required: false,
      label: { default: "I agree to the terms" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "other-q": "value" }, // No consent data
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "consent-q1", impressions: 1, dropOffCount: 1, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Consent);
    expect(summary[0].responseCount).toBe(0);
    expect(summary[0].accepted.count).toBe(0);
    expect(summary[0].accepted.percentage).toBe(0);
    expect(summary[0].dismissed.count).toBe(0);
    expect(summary[0].dismissed.percentage).toBe(0);
  });

  test("getQuestionSummary handles Consent with invalid values", async () => {
    const question = {
      id: "consent-q1",
      type: TSurveyElementTypeEnum.Consent,
      headline: { default: "Do you consent to our terms?" },
      required: true,
      label: { default: "I agree to the terms" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "consent-q1": "invalid-value" }, // Invalid value
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "consent-q1": 3 },
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "consent-q1", impressions: 1, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Consent);
    expect(summary[0].responseCount).toBe(1); // Counted as response due to ttc
    expect(summary[0].accepted.count).toBe(0); // Not accepted
    expect(summary[0].dismissed.count).toBe(1); // Counted as dismissed
  });
});

describe("Date question type tests", () => {
  test("getQuestionSummary correctly processes Date question with valid responses", async () => {
    const question = {
      id: "date-q1",
      type: TSurveyElementTypeEnum.Date,
      headline: { default: "When is your birthday?" },
      required: true,
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "date-q1": "2023-01-15" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: { "date-q1": "1990-05-20" },
        updatedAt: new Date(),
        contact: { id: "contact-1", userId: "user-1" },
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "date-q1", impressions: 2, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Date);
    expect(summary[0].responseCount).toBe(2);
    expect(summary[0].samples).toHaveLength(2);

    // Check sample values
    expect(summary[0].samples[0].value).toBe("2023-01-15");
    expect(summary[0].samples[1].value).toBe("1990-05-20");

    // Check contact information is preserved
    expect(summary[0].samples[1].contact).toEqual({ id: "contact-1", userId: "user-1" });
  });

  test("getQuestionSummary handles Date question with no responses", async () => {
    const question = {
      id: "date-q1",
      type: TSurveyElementTypeEnum.Date,
      headline: { default: "When is your birthday?" },
      required: false,
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {}, // No date data
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "date-q1", impressions: 1, dropOffCount: 1, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Date);
    expect(summary[0].responseCount).toBe(0);
    expect(summary[0].samples).toHaveLength(0);
  });

  test("getQuestionSummary applies VALUES_LIMIT correctly for Date question", async () => {
    const question = {
      id: "date-q1",
      type: TSurveyElementTypeEnum.Date,
      headline: { default: "When is your birthday?" },
      required: true,
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    // Create 100 responses (more than VALUES_LIMIT which is 50)
    const responses = Array.from({ length: 100 }, (_, i) => ({
      id: `response-${i}`,
      data: { "date-q1": `2023-01-${(i % 28) + 1}` },
      updatedAt: new Date(),
      contact: null,
      contactAttributes: {},
      language: null,
      ttc: {},
      finished: true,
    }));

    const dropOff = [
      { elementId: "date-q1", impressions: 100, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Date);
    expect(summary[0].responseCount).toBe(100);
    expect(summary[0].samples).toHaveLength(50); // Limited to VALUES_LIMIT (50)
  });
});

describe("FileUpload question type tests", () => {
  test("getQuestionSummary correctly processes FileUpload question with valid responses", async () => {
    const question = {
      id: "file-q1",
      type: TSurveyElementTypeEnum.FileUpload,
      headline: { default: "Upload your documents" },
      required: true,
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {
          "file-q1": ["https://example.com/file1.pdf", "https://example.com/file2.jpg"],
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: {
          "file-q1": ["https://example.com/file3.docx"],
        },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "file-q1", impressions: 2, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.FileUpload);
    expect(summary[0].responseCount).toBe(2);
    expect(summary[0].files).toHaveLength(2);

    // Check file values
    expect(summary[0].files[0].value).toEqual([
      "https://example.com/file1.pdf",
      "https://example.com/file2.jpg",
    ]);
    expect(summary[0].files[1].value).toEqual(["https://example.com/file3.docx"]);
  });

  test("getQuestionSummary handles FileUpload question with no responses", async () => {
    const question = {
      id: "file-q1",
      type: TSurveyElementTypeEnum.FileUpload,
      headline: { default: "Upload your documents" },
      required: false,
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {}, // No file data
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "file-q1", impressions: 1, dropOffCount: 1, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.FileUpload);
    expect(summary[0].responseCount).toBe(0);
    expect(summary[0].files).toHaveLength(0);
  });
});

describe("Cal question type tests", () => {
  test("getQuestionSummary correctly processes Cal with valid responses", async () => {
    const question = {
      id: "cal-q1",
      type: TSurveyElementTypeEnum.Cal,
      headline: { default: "Book a meeting with us" },
      required: true,
      calUserName: "test-user",
      calEventSlug: "15min",
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "cal-q1": "booked" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: {}, // Skipped but spent time
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "cal-q1": 10 },
        finished: true,
      },
      {
        id: "response-3",
        data: { "cal-q1": "booked" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "cal-q1", impressions: 3, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Cal);
    expect(summary[0].responseCount).toBe(3);

    // 2 booked / 3 total = 66.67%
    expect(summary[0].booked.count).toBe(2);
    expect(summary[0].booked.percentage).toBe(66.67);

    // 1 skipped / 3 total = 33.33%
    expect(summary[0].skipped.count).toBe(1);
    expect(summary[0].skipped.percentage).toBe(33.33);
  });

  test("getQuestionSummary handles Cal with no responses", async () => {
    const element = {
      id: "cal-q1",
      type: TSurveyElementTypeEnum.Cal,
      headline: { default: "Book a meeting with us" },
      required: false,
      calUserName: "test-user",
      calEventSlug: "15min",
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [element],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "other-q": "value" }, // No Cal data
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "cal-q1", impressions: 1, dropOffCount: 1, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Cal);
    expect(summary[0].responseCount).toBe(0);
    expect(summary[0].booked.count).toBe(0);
    expect(summary[0].booked.percentage).toBe(0);
    expect(summary[0].skipped.count).toBe(0);
    expect(summary[0].skipped.percentage).toBe(0);
  });

  test("getQuestionSummary handles Cal with invalid values", async () => {
    const question = {
      id: "cal-q1",
      type: TSurveyElementTypeEnum.Cal,
      headline: { default: "Book a meeting with us" },
      required: true,
      calUserName: "test-user",
      calEventSlug: "15min",
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "cal-q1": "invalid-value" }, // Invalid value
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "cal-q1": 5 },
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "cal-q1", impressions: 1, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Cal);
    expect(summary[0].responseCount).toBe(1); // Counted as response due to ttc
    expect(summary[0].booked.count).toBe(0);
    expect(summary[0].skipped.count).toBe(1); // Counted as skipped
  });
});

describe("OpinionScale question type tests", () => {
  test("getQuestionSummary correctly processes OpinionScale question with valid responses", async () => {
    const question = {
      id: "opinion-q1",
      type: TSurveyElementTypeEnum.OpinionScale,
      headline: { default: "How likely are you to recommend?" },
      required: true,
      scaleRange: 5,
      visualStyle: "number",
      lowerLabel: { default: "Not likely" },
      upperLabel: { default: "Very likely" },
      isColorCodingEnabled: false,
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "opinion-q1": 5 },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-2",
        data: { "opinion-q1": 4 },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-3",
        data: { "opinion-q1": 3 },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
      {
        id: "response-4",
        data: { "opinion-q1": 5 },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "opinion-q1", impressions: 4, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.OpinionScale);
    expect(summary[0].responseCount).toBe(4);

    // Average = (5 + 4 + 3 + 5) / 4 = 4.25
    expect(summary[0].average).toBe(4.25);

    // Verify each scale value count and percentage
    const val5 = summary[0].choices.find((c: any) => c.rating === 5);
    expect(val5.count).toBe(2);
    expect(val5.percentage).toBe(50); // 2/4 * 100

    const val4 = summary[0].choices.find((c: any) => c.rating === 4);
    expect(val4.count).toBe(1);
    expect(val4.percentage).toBe(25);

    const val3 = summary[0].choices.find((c: any) => c.rating === 3);
    expect(val3.count).toBe(1);
    expect(val3.percentage).toBe(25);

    const val2 = summary[0].choices.find((c: any) => c.rating === 2);
    expect(val2.count).toBe(0);
    expect(val2.percentage).toBe(0);

    const val1 = summary[0].choices.find((c: any) => c.rating === 1);
    expect(val1.count).toBe(0);
    expect(val1.percentage).toBe(0);

    // Verify dismissed
    expect(summary[0].dismissed.count).toBe(0);
  });

  test("getQuestionSummary handles OpinionScale question with dismissed responses", async () => {
    const question = {
      id: "opinion-q1",
      type: TSurveyElementTypeEnum.OpinionScale,
      headline: { default: "How likely are you to recommend?" },
      required: false,
      scaleRange: 5,
      visualStyle: "number",
      lowerLabel: { default: "Not likely" },
      upperLabel: { default: "Very likely" },
      isColorCodingEnabled: false,
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "opinion-q1": 5 },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "opinion-q1": 3 },
        finished: true,
      },
      {
        id: "response-2",
        data: {},
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "opinion-q1": 2 },
        finished: true,
      },
      {
        id: "response-3",
        data: {},
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "opinion-q1": 4 },
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "opinion-q1", impressions: 3, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.OpinionScale);
    expect(summary[0].responseCount).toBe(1);
    expect(summary[0].average).toBe(5);
    expect(summary[0].dismissed.count).toBe(2);
  });

  test("getQuestionSummary handles OpinionScale question with no responses", async () => {
    const question = {
      id: "opinion-q1",
      type: TSurveyElementTypeEnum.OpinionScale,
      headline: { default: "How likely are you to recommend?" },
      required: true,
      scaleRange: 5,
      visualStyle: "number",
      lowerLabel: { default: "Not likely" },
      upperLabel: { default: "Very likely" },
      isColorCodingEnabled: false,
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "other-q": "value" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "opinion-q1", impressions: 1, dropOffCount: 1, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.OpinionScale);
    expect(summary[0].responseCount).toBe(0);
    expect(summary[0].average).toBe(0);

    summary[0].choices.forEach((choice: any) => {
      expect(choice.count).toBe(0);
      expect(choice.percentage).toBe(0);
    });

    expect(summary[0].dismissed.count).toBe(0);
  });
});

describe("Payment question type tests", () => {
  test("getQuestionSummary correctly processes Payment question with valid responses", async () => {
    const question = {
      id: "payment-q1",
      type: TSurveyElementTypeEnum.Payment,
      headline: { default: "Complete your payment" },
      required: true,
      currency: "usd",
      amount: 1000,
      buttonLabel: { default: "Pay $10.00" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "payment-q1": "paid" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "payment-q1": 5 },
        finished: true,
      },
      {
        id: "response-2",
        data: { "payment-q1": "paid" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "payment-q1": 3 },
        finished: true,
      },
      {
        id: "response-3",
        data: {},
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "payment-q1": 2 },
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "payment-q1", impressions: 3, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Payment);
    expect(summary[0].responseCount).toBe(3);
    expect(summary[0].totalAmount).toBe(2000); // 2 paid * 1000 amount
    expect(summary[0].currency).toBe("usd");
    expect(summary[0].successCount).toBe(2);
    expect(summary[0].skippedCount).toBe(1);
  });

  test("getQuestionSummary handles Payment question with no responses", async () => {
    const question = {
      id: "payment-q1",
      type: TSurveyElementTypeEnum.Payment,
      headline: { default: "Complete your payment" },
      required: false,
      currency: "eur",
      amount: 500,
      buttonLabel: { default: "Pay €5.00" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: { "other-q": "value" },
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: {},
        finished: true,
      },
    ];

    const dropOff = [
      { elementId: "payment-q1", impressions: 1, dropOffCount: 1, dropOffPercentage: 100 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Payment);
    expect(summary[0].responseCount).toBe(0);
    expect(summary[0].totalAmount).toBe(0);
    expect(summary[0].currency).toBe("eur");
    expect(summary[0].successCount).toBe(0);
    expect(summary[0].skippedCount).toBe(0);
  });

  test("getQuestionSummary handles Payment question with all skipped responses", async () => {
    const question = {
      id: "payment-q1",
      type: TSurveyElementTypeEnum.Payment,
      headline: { default: "Complete your payment" },
      required: false,
      currency: "gbp",
      amount: 2000,
      buttonLabel: { default: "Pay £20.00" },
    };

    const survey = {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;

    const responses = [
      {
        id: "response-1",
        data: {},
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "payment-q1": 5 },
        finished: true,
      },
      {
        id: "response-2",
        data: {},
        updatedAt: new Date(),
        contact: null,
        contactAttributes: {},
        language: null,
        ttc: { "payment-q1": 3 },
        finished: true,
      },
    ] as any;

    const dropOff = [
      { elementId: "payment-q1", impressions: 2, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      dropOff
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Payment);
    expect(summary[0].responseCount).toBe(2);
    expect(summary[0].totalAmount).toBe(0);
    expect(summary[0].successCount).toBe(0);
    expect(summary[0].skippedCount).toBe(2);
  });
});

describe("Slider question type tests", () => {
  // The slider aggregation reports exactly five fields — type, element, responseCount, average and
  // dismissed.count — because a continuous range has no fixed buckets to distribute answers into. Both
  // helper types are derived from the symbols this file already imports, so the suite stays typed without
  // widening anything to `any`.
  type TSliderSummary = Extract<TSurveySummary["summary"][number], { type: TSurveyElementTypeEnum.Slider }>;
  type TSliderElement = Extract<TSurveyElement, { type: TSurveyElementTypeEnum.Slider }>;
  type TSummaryResponses = Parameters<typeof getElementSummary>[2];

  const sliderElementId = "slider-q1";

  const createSliderElement = (overrides: Partial<TSliderElement> = {}): TSliderElement => ({
    id: sliderElementId,
    type: TSurveyElementTypeEnum.Slider,
    headline: { default: "How likely are you to recommend us?" },
    required: true,
    range: { min: 0, max: 100 },
    step: 5,
    lowerLabel: { default: "Not likely" },
    upperLabel: { default: "Very likely" },
    showValue: true,
    ...overrides,
  });

  const createSurvey = (element: TSliderElement): TSurvey =>
    ({
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [element],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    }) as unknown as TSurvey;

  const createResponse = (
    id: string,
    data: TSummaryResponses[number]["data"],
    ttc: TSummaryResponses[number]["ttc"] = {}
  ): TSummaryResponses[number] => ({
    id,
    data,
    updatedAt: new Date(),
    contact: null,
    contactAttributes: {},
    language: null,
    ttc,
    finished: true,
  });

  const dropOff = [
    { elementId: sliderElementId, impressions: 0, dropOffCount: 0, dropOffPercentage: 0 },
  ] as unknown as TSurveySummary["dropOff"];

  // Builds the survey around the given element, runs the real aggregation and narrows the single entry it
  // produces. A missing entry would mean the aggregation switch has no slider case at all, since that
  // switch has no default branch.
  const summarizeSlider = async (
    responses: TSummaryResponses,
    element: TSliderElement = createSliderElement()
  ): Promise<TSliderSummary> => {
    const survey = createSurvey(element);
    const summary = await getElementSummary(survey, getElementsFromBlocks(survey.blocks), responses, dropOff);

    expect(summary).toHaveLength(1);
    return summary[0] as TSliderSummary;
  };

  test("getElementSummary correctly processes Slider question with valid responses", async () => {
    const summary = await summarizeSlider([
      createResponse("response-1", { [sliderElementId]: 0 }),
      createResponse("response-2", { [sliderElementId]: 50 }),
      createResponse("response-3", { [sliderElementId]: 100 }),
      createResponse("response-4", { [sliderElementId]: 25 }),
    ]);

    expect(summary.type).toBe(TSurveyElementTypeEnum.Slider);
    expect(summary.element.id).toBe(sliderElementId);
    expect(summary.responseCount).toBe(4);
    // (0 + 50 + 100 + 25) / 4 = 43.75 — the zero is part of the average, not a skipped response.
    expect(summary.average).toBe(43.75);
    expect(summary.dismissed.count).toBe(0);
  });

  test("getElementSummary reports only the fields the Slider summary contract declares", async () => {
    const summary = await summarizeSlider([createResponse("response-1", { [sliderElementId]: 40 })]);

    expect(Object.keys(summary).sort()).toEqual(["average", "dismissed", "element", "responseCount", "type"]);
  });

  test("getElementSummary counts a Slider answered with zero as a response", async () => {
    // The response also carries time on the element, so a truthiness test instead of a type test would
    // misclassify this answer as a dismissal.
    const summary = await summarizeSlider([
      createResponse("response-1", { [sliderElementId]: 0 }, { [sliderElementId]: 4 }),
    ]);

    expect(summary.responseCount).toBe(1);
    expect(summary.average).toBe(0);
    expect(summary.dismissed.count).toBe(0);
  });

  test("getElementSummary ignores a non-numeric Slider answer", async () => {
    const summary = await summarizeSlider([createResponse("response-1", { [sliderElementId]: "50" })]);

    expect(summary.responseCount).toBe(0);
    expect(summary.average).toBe(0);
    expect(summary.dismissed.count).toBe(0);
  });

  test("getElementSummary handles Slider question with dismissed responses", async () => {
    const summary = await summarizeSlider([
      createResponse("response-1", { [sliderElementId]: 20 }, { [sliderElementId]: 3 }),
      createResponse("response-2", {}, { [sliderElementId]: 2 }),
      createResponse("response-3", {}, { [sliderElementId]: 4 }),
    ]);

    expect(summary.responseCount).toBe(1);
    expect(summary.average).toBe(20);
    expect(summary.dismissed.count).toBe(2);
  });

  test("getElementSummary does not count a Slider as dismissed without time on the element", async () => {
    const summary = await summarizeSlider([
      createResponse("response-1", {}, { [sliderElementId]: 0 }),
      createResponse("response-2", {}, { "another-element": 5 }),
    ]);

    expect(summary.responseCount).toBe(0);
    expect(summary.average).toBe(0);
    expect(summary.dismissed.count).toBe(0);
  });

  test("getElementSummary handles Slider question with no responses", async () => {
    const summary = await summarizeSlider([createResponse("response-1", { "another-element": "value" })]);

    expect(summary.responseCount).toBe(0);
    // Averaging nothing divides by zero, so the aggregation must normalise NaN to 0 — the summary card
    // renders this value directly and a NaN would surface as a broken progress indicator.
    expect(summary.average).toBe(0);
    expect(Number.isNaN(summary.average)).toBe(false);
    expect(summary.dismissed.count).toBe(0);
  });

  test("getElementSummary handles Slider question when the survey has no responses at all", async () => {
    const summary = await summarizeSlider([]);

    expect(summary.responseCount).toBe(0);
    expect(summary.average).toBe(0);
    expect(Number.isNaN(summary.average)).toBe(false);
    expect(summary.dismissed.count).toBe(0);
  });

  test("getElementSummary averages raw values for a Slider range that does not start at zero", async () => {
    const summary = await summarizeSlider(
      [
        createResponse("response-1", { [sliderElementId]: 10 }),
        createResponse("response-2", { [sliderElementId]: 20 }),
      ],
      createSliderElement({ range: { min: 10, max: 50 } })
    );

    expect(summary.responseCount).toBe(2);
    // The average is the plain mean of the submitted values, not a position within the range.
    expect(summary.average).toBe(15);
    expect(summary.element.range).toEqual({ min: 10, max: 50 });
  });

  test("getElementSummary rounds the Slider average to two decimals", async () => {
    const summary = await summarizeSlider([
      createResponse("response-1", { [sliderElementId]: 10 }),
      createResponse("response-2", { [sliderElementId]: 10 }),
      createResponse("response-3", { [sliderElementId]: 11 }),
    ]);

    expect(summary.responseCount).toBe(3);
    // The mean of the submitted values, reported through the same two-decimal helper the opinion-scale case
    // uses, so a Slider card reads exactly as its siblings do.
    expect(summary.average).toBe(10.33);
  });

  test("getElementSummary reports the Slider average at the summary's own two-decimal precision", async () => {
    // A {0, 0.001} range with step 0.0001 is a schema-valid configuration, and finer than the two decimals
    // every summary card in this folder displays - so its mean is reported at the summary's precision rather
    // than at the grid's. That is the boundary of this element's minimal numeric aggregation: per-value
    // distribution and precision analysis are deliberately out of its scope.
    const summary = await summarizeSlider(
      [
        createResponse("response-1", { [sliderElementId]: 0 }),
        createResponse("response-2", { [sliderElementId]: 0.001 }),
      ],
      createSliderElement({ range: { min: 0, max: 0.001 }, step: 0.0001 })
    );

    expect(summary.responseCount).toBe(2);
    expect(summary.average).toBe(0);
  });

  test("getElementSummary reports a single Slider answer as its own mean", async () => {
    const summary = await summarizeSlider([createResponse("response-1", { [sliderElementId]: 35 })]);

    expect(summary.responseCount).toBe(1);
    expect(summary.average).toBe(35);
  });
});

describe("Slider question type numerical stability tests", () => {
  const buildSliderSurvey = (range: { min: number; max: number }, step: number) => {
    const question = {
      id: "slider-q1",
      type: TSurveyElementTypeEnum.Slider,
      headline: { default: "How satisfied are you?" },
      required: true,
      range,
      step,
      lowerLabel: { default: "Low" },
      upperLabel: { default: "High" },
      showValue: true,
    };

    return {
      id: "survey-1",
      blocks: [
        {
          id: "block1",
          name: "Block 1",
          elements: [question],
        },
      ],
      questions: [],
      languages: [],
      welcomeCard: { enabled: false },
    } as unknown as TSurvey;
  };

  const buildSliderResponses = (values: (number | undefined)[]) =>
    values.map((value, index) => ({
      id: `response-${index + 1}`,
      data: value === undefined ? {} : { "slider-q1": value },
      updatedAt: new Date(),
      contact: null,
      contactAttributes: {},
      language: null,
      // A response without a value only counts as a dismissal when it recorded time on the element.
      ttc: value === undefined ? { "slider-q1": 4 } : {},
      finished: true,
    })) as any;

  const buildDropOff = (impressions: number) =>
    [
      { elementId: "slider-q1", impressions, dropOffCount: 0, dropOffPercentage: 0 },
    ] as unknown as TSurveySummary["dropOff"];

  test("getElementSummary averages Slider answers and counts a zero answer as a response", async () => {
    const survey = buildSliderSurvey({ min: 0, max: 100 }, 5);
    const responses = buildSliderResponses([50, 0, 100]);

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(3)
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].type).toBe(TSurveyElementTypeEnum.Slider);
    // A Slider whose range starts at 0 and which was answered 0 is answered, never dismissed.
    expect(summary[0].responseCount).toBe(3);
    expect(summary[0].average).toBe(50);
    expect(summary[0].dismissed.count).toBe(0);
  });

  test("getElementSummary handles Slider question with dismissed and no valid responses", async () => {
    const survey = buildSliderSurvey({ min: 0, max: 100 }, 5);
    const responses = buildSliderResponses([undefined, undefined]);

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(2)
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].responseCount).toBe(0);
    // An empty answer set reports 0 rather than the NaN a sum divided by zero would produce.
    expect(summary[0].average).toBe(0);
    expect(Number.isNaN(summary[0].average)).toBe(false);
    expect(summary[0].dismissed.count).toBe(2);
  });

  test("getElementSummary keeps the Slider average finite for very large in-range answers", async () => {
    // This configuration and these answers are schema-valid: the bounds and the step are finite, the span is
    // finite, and every answer sits on the grid. Thirty of them sum to 2.7e308, which no double holds, so
    // this is the answer set that exercises the aggregation's overflow-safe pass before the mean reaches the
    // shared two-decimal helper. What the summary must never do is report NaN or omit the entry.
    const largeValue = 9e306;
    const survey = buildSliderSurvey({ min: 0, max: largeValue }, largeValue);
    const responses = buildSliderResponses(new Array(30).fill(largeValue));

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(30)
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].responseCount).toBe(30);
    expect(typeof summary[0].average).toBe("number");
    expect(Number.isNaN(summary[0].average)).toBe(false);
  });

  test("getElementSummary routes the Slider mean through the shared two-decimal helper", async () => {
    // The same helper, called the same way, as every other averaged summary in this folder - which is what
    // keeps a Slider card's mean formatted like its siblings' rather than by a policy of its own.
    const largeValue = 9e306;
    const survey = buildSliderSurvey({ min: 0, max: largeValue }, largeValue);
    const responses = buildSliderResponses([largeValue]);

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(1)
    );

    expect(summary).toHaveLength(1);
    expect(convertFloatTo2Decimal).toHaveBeenCalledWith(largeValue);
    expect(Number.isNaN(summary[0].average)).toBe(false);
  });

  test("getElementSummary keeps the Slider average finite when the answers span the double range", async () => {
    // The case an in-place fold cannot survive. A running sum leaves the double range on the second answer,
    // and the textbook incremental mean computes `-1e308 - 1e308` on the third step - a subtraction of two
    // finite values that overflows to -Infinity on its own, before any division can bring it back - so the
    // finiteness guard would report 0 for a set whose mean is about 3.33e307. The aggregation reads the
    // element exactly as it is stored rather than reparsing it, which is why a range this wide reaches it at
    // all: the schema refuses one this wide today, but rows written before that refinement landed, and
    // elements written straight through the management API, still arrive here.
    const survey = buildSliderSurvey({ min: -1e308, max: 1e308 }, 1e307);
    const responses = buildSliderResponses([1e308, 1e308, -1e308]);

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(3)
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].responseCount).toBe(3);
    expect(Number.isFinite(summary[0].average)).toBe(true);
    expect(summary[0].average).not.toBe(0);
    // The exact mean, to the last bit: summing each answer's share and carrying the bits every addition
    // rounds away reproduces 1e308 / 3 rather than merely approaching it. Two decimals cannot narrow a
    // figure of this magnitude, so the reported average is that mean unchanged.
    expect(summary[0].average).toBe(1e308 / 3);
  });

  test("getElementSummary recovers a small Slider mean from answers that cancel at full scale", async () => {
    // The same hazard at its sharpest: two answers at the top of the double range that cancel exactly, plus
    // a small one. Their mean is 1/3, and it survives only because each answer contributes its own share of
    // the mean and the bits those additions round away are carried rather than dropped. A fold that lost
    // them would report 0 here, so the reported 0.33 - the exact mean rounded like every other average in
    // this file - is what proves the small figure was recovered rather than cancelled away.
    const survey = buildSliderSurvey({ min: -Number.MAX_VALUE, max: Number.MAX_VALUE }, 1);
    const responses = buildSliderResponses([Number.MAX_VALUE, 1, -Number.MAX_VALUE]);

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(3)
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].responseCount).toBe(3);
    expect(convertFloatTo2Decimal).toHaveBeenCalledWith(1 / 3);
    expect(summary[0].average).toBe(0.33);
  });

  test("getElementSummary keeps the Slider average finite for every ordering of extreme answers", async () => {
    // Order decides where an overflow would fall, so no single ordering proves the arithmetic safe. This walks
    // every ordered triple drawn from the magnitudes a stored range reaches and asserts a finite mean for all
    // of them - the aggregation must never hand the card a value its own contract forbids.
    const extremes = [Number.MAX_VALUE, -Number.MAX_VALUE, 1e308, -1e308, 0, 1, -1];

    for (const first of extremes) {
      for (const second of extremes) {
        for (const third of extremes) {
          const survey = buildSliderSurvey({ min: -Number.MAX_VALUE, max: Number.MAX_VALUE }, 1);
          const responses = buildSliderResponses([first, second, third]);

          const summary: any = await getElementSummary(
            survey,
            getElementsFromBlocks(survey.blocks),
            responses,
            buildDropOff(3)
          );

          expect(Number.isFinite(summary[0].average)).toBe(true);
        }
      }
    }
  });

  test("getElementSummary still reports zero for a Slider answer that is not a finite number", async () => {
    // No arithmetic over the shares can turn a stored Infinity back into a number, so the finiteness guard is
    // what keeps the `average: z.number()` this summary declares honest for response data like this - and what
    // keeps the entry serializable, since a non-finite number reaches the client as null. It is counted as a
    // response, because it is one - only the mean it produces is unreportable.
    const survey = buildSliderSurvey({ min: 0, max: 100 }, 5);
    const responses = buildSliderResponses([Number.POSITIVE_INFINITY, 50]);

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(2)
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].responseCount).toBe(2);
    expect(summary[0].average).toBe(0);
  });

  test("getElementSummary reports the Slider average within an offset range", async () => {
    const survey = buildSliderSurvey({ min: 10, max: 50 }, 5);
    const responses = buildSliderResponses([10, 15, 25]);

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(3)
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].responseCount).toBe(3);
    // (10 + 15 + 25) / 3 = 16.666..., reported as the two decimals the summary displays. The mean is measured
    // in the range's own units, so an offset range is never mistaken for one anchored at zero.
    expect(summary[0].average).toBe(16.67);
  });

  test("getElementSummary reports a Slider mean on an offset grid finer than the summary's precision", async () => {
    // A grid whose origin and step are both finer than 0.01. The mean is still reported at the summary's own
    // two decimals, which is the precision the card displays; what matters here is that such a configuration
    // produces an ordinary number rather than NaN or no entry at all.
    const survey = buildSliderSurvey({ min: 0.005, max: 0.105 }, 0.01);
    const responses = buildSliderResponses([0.005, 0.015, 0.035]);

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(3)
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].responseCount).toBe(3);
    expect(summary[0].average).toBe(0.02);
  });

  test("getElementSummary averages opposite-signed extreme Slider answers exactly", async () => {
    // `{min: -1e308, max: 1e308}` with step 1e308 describes a span of 2e308, which the element schema now
    // refuses outright - but the aggregation reads the element as stored rather than reparsing it, so stored
    // responses to a slider saved before that guard, or written straight through the management API, still
    // reach it. -1e308, 0 and 1e308 are the three values on that grid, so answers at alternating extremes are
    // exactly what such data looks like.
    //
    // A textbook incremental mean cannot survive it: `-1e308 - 1e308` overflows, so the accumulator went
    // to -Infinity on the second answer, to NaN on the third, and the finiteness guard then reported 0 -
    // a mean of zero for answers whose mean is a third of 1e308.
    const survey = buildSliderSurvey({ min: -1e308, max: 1e308 }, 1e308);
    const responses = buildSliderResponses([1e308, -1e308, 1e308]);

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(3)
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].responseCount).toBe(3);
    expect(Number.isFinite(summary[0].average)).toBe(true);
    expect(Number.isNaN(summary[0].average)).toBe(false);
    // These three answers cancel down to a sum of 1e308, which a double holds, so the exact mean is
    // reported: one rounding, on 1e308 / 3.
    expect(summary[0].average).toBe(1e308 / 3);
    expect(summary[0].average).not.toBe(0);
  });

  test("getElementSummary averages mixed-sign Slider answers whose sum cannot be represented", async () => {
    // The same extreme range, ordered so the sum leaves the double range before the negative answer can
    // bring it back: 1e308 + 1e308 is already Infinity, and Infinity - 1e308 stays Infinity. The mean is
    // still a third of 1e308, and the overflow-safe pass is what recovers it.
    const survey = buildSliderSurvey({ min: -1e308, max: 1e308 }, 1e308);
    const responses = buildSliderResponses([1e308, 1e308, -1e308]);

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(3)
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].responseCount).toBe(3);
    expect(Number.isFinite(summary[0].average)).toBe(true);
    expect(Number.isNaN(summary[0].average)).toBe(false);
    // Accumulating in three weighted steps rounds three times rather than once, so the figure is asserted
    // as the magnitude it must be - about 3.33e307 - rather than pinned to one particular rounding of it.
    expect(summary[0].average).toBeGreaterThan(3.3e307);
    expect(summary[0].average).toBeLessThan(3.4e307);
  });

  test("getElementSummary averages extreme Slider answers that cancel to zero", async () => {
    // Two answers at opposite extremes have a mean of exactly zero. That is the one case where the
    // reported 0 is the true mean rather than the finiteness guard's fallback, so it is asserted
    // alongside a response count that proves the answers were counted rather than skipped.
    const survey = buildSliderSurvey({ min: -1e308, max: 1e308 }, 1e308);
    const responses = buildSliderResponses([-1e308, 1e308]);

    const summary: any = await getElementSummary(
      survey,
      getElementsFromBlocks(survey.blocks),
      responses,
      buildDropOff(2)
    );

    expect(summary).toHaveLength(1);
    expect(summary[0].responseCount).toBe(2);
    expect(summary[0].average).toBe(0);
    expect(Number.isNaN(summary[0].average)).toBe(false);
  });
});
