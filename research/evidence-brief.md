# CycleSync Evidence Brief

Last updated Nov 10, 2026 · Julia Simon

Living version: Claude Docs "CycleSync Evidence Brief". This file is the copy Claude Code reads.

## Bottom line

The evidence does not support prescribing workouts or diets by cycle phase. Phase effects on performance are small and inconsistent, and the authors of the main reviews recommend a personalized approach based on each woman's own response. That is CycleSync's core principle: how she feels comes first, and cycle phase is context.

A few cycle-related effects are real and useful: appetite rises slightly in the luteal phase, body temperature runs higher in the luteal phase, regular exercise may ease period pain, and heavy bleeding raises iron-deficiency risk. Missing periods can signal under-fueling. Most studies are small and low quality, so CycleSync should state these as tendencies, never rules.

## Workouts and the cycle

No phase reliably makes a workout better or worse; individual responses vary more than phase averages.

| Question | What the evidence shows | Strength of evidence |
| --- | --- | --- |
| Does phase change performance? | Performance may be slightly lower in the early follicular phase (during the period), but the effect is "trivial." No general guidelines can be formed; personalize instead (McNulty 2020, 78 studies, 1,193 women). | Low: only 8% of studies high quality |
| Should strength training follow phases? | No influence of phase on strength performance or long-term gains; evidence doesn't support phase-based programs (Colenso-Semple 2023). | Low, methodologically weak |
| Does phase raise injury (ACL) risk? | Inconclusive. Most studies found no phase difference; two hinted at the mid-luteal phase. Authors advise caution before changing training by phase (Dos'Santos 2023). | Very low |
| Does phase affect heat tolerance? | Core temperature runs higher in the luteal phase before and after exercise in heat; sweat rate doesn't change (Giersch 2020, 9 studies). | Limited |
| Does exercise help period pain? | Regular exercise may substantially reduce period pain, about 25 points on a 100-point scale, at low or high intensity (Cochrane 2019, 9 trials, 632 women). Trials mostly tested exercise across the whole month. | Low to very low |
| What about the pill? | Pill users may perform slightly worse on average, but the effect is most likely trivial and performance is steady across the pill cycle (Elliott-Sale 2020, 42 studies). | Mostly moderate to very low |

## Food and the cycle

The cycle shifts appetite and some nutrient needs slightly; the biggest nutrition risks for active women are low iron and under-fueling, not phase-specific eating. Nutrition is a non-goal for CycleSync right now.

| Topic | What the evidence shows | Strength of evidence |
| --- | --- | --- |
| Appetite and intake | Women eat about 168 kcal/day more in the luteal phase than the follicular phase (Tucker 2025, 15 datasets, 330 women). | Mixed: 8 of 15 datasets found a difference |
| Resting metabolism | Resting energy use may rise about 3-5% (roughly 30-120 kcal/day) in the luteal phase, possibly within normal day-to-day variation (Hurtova 2026, 7 studies). An earlier meta-analysis of 26 studies also found a small luteal increase (Benton 2020). | Small and inconsistent |
| Iron and heavy bleeding | Heavy menstrual bleeding was reported by 36% of London Marathon runners and 37% of elite athletes, and was linked to more anaemia (Bruinvels 2016). Menstruation costs about 1 mg iron/day; heavy bleeding up to 5-6 times more. Iron-rich foods with vitamin C; supplements only after a blood test (Pedlar 2018). | Moderate for the risk; limited for diet strategies |
| PMS and calcium/vitamin D | Low calcium and vitamin D are linked to worse PMS symptoms, and some trials found supplements helped (Abdi 2019). | Mixed and uncertain |
| Under-fueling (REDs) | Missing periods for 3 or more cycles, or cycles longer than 35 days, are recognized warning signs of low energy availability, once other causes are ruled out (IOC REDs consensus 2023). | Expert consensus, aimed at competitive athletes |

If nutrition is ever added: gentle, food-first, never calorie targets. A slightly bigger appetite before a period is normal, not a problem to fix.

## Claims the evidence doesn't support (never make these)

- "Train hard in your follicular phase, go easy in your luteal phase."
- "Your phase determines your workout."
- Seed cycling (no controlled trials of the practice).
- Big phase-based calorie changes.
- "Avoid exercise during your period." (No evidence it's harmful; regular exercise may reduce period pain.)

## Rules for the AI

1. How she reports feeling (energy, sleep, symptoms, soreness) drives the recommendation. Cycle day and estimated phase are context only.
2. Never claim a phase improves or worsens performance, strength or injury risk.
3. Learn her own patterns (onboarding questions, then feedback) instead of applying population averages.
4. On cramp days, offer gentle movement (walk, yoga, easy spin) first, with rest as an equal option. This is an inference from evidence on regular exercise, not tested on the day itself.
5. In the luteal phase, mention heat and hydration on hot days or long sessions.
6. If she uses hormonal contraception, skip natural-phase labels.
7. Use hedged language ("some women find", "you reported last time"), never "science says".

## Safety rules (override everything; implemented in code, not left to the AI)

- Bleeding that soaks a pad or tampon every hour for more than two hours, bleeding longer than a week, clots larger than a quarter, or fatigue or shortness of breath from blood loss: suggest seeing a doctor, no workout advice (Mayo Clinic).
- Heavy periods plus ongoing fatigue: suggest asking a doctor about an iron check.
- Missed periods for 3 or more months, or cycles over 35 days: gently suggest a doctor visit, since this can signal under-fueling.
- Cramps that are worse than her usual, not helped by pain relief, or come with fever or vomiting: suggest a doctor, not a workout tweak. Bad but typical cramps don't trigger this; they get the normal cramp-day advice (gentle movement or rest as equal options).

Open: have a sports medicine or women's health professional review these rules.

## Sources

- McNulty KL et al. (2020). The effects of menstrual cycle phase on exercise performance in eumenorrheic women. Sports Medicine. https://rrmacademy.org/library/the-effects-of-menstrual-cycle-phase-on-exercise-performance-in-eumenorrheic-wom-ouqt6anh/
- Colenso-Semple LM et al. (2023). Current evidence shows no influence of women's menstrual cycle phase on acute strength performance or adaptations to resistance exercise training. Frontiers in Sports and Active Living. https://www.frontiersin.org/articles/10.3389/fspor.2023.1054542/pdf
- Dos'Santos T et al. (2023). Effects of the menstrual cycle phase on ACL injury risk surrogates: a systematic review. PLoS ONE. https://pmc.ncbi.nlm.nih.gov/articles/PMC9879429/
- Giersch GEW et al. (2020). Menstrual cycle and thermoregulation during exercise in the heat: a systematic review and meta-analysis. J Sci Med Sport. https://nutrition-evidence.com/article/352142/menstrual-cycle-and-thermoregulation-during-exercise-in-the-heat-a-systematic-review-and-meta-analysis
- Armour M et al. (2019). Exercise for dysmenorrhoea. Cochrane Database of Systematic Reviews. https://www.cochrane.org/evidence/CD004142-exercise-dysmenorrhoea
- Elliott-Sale KJ et al. (2020). The effects of oral contraceptives on exercise performance in women. Sports Medicine. https://nrl.northumbria.ac.uk/id/eprint/43772
- Tucker et al. (2025). The effect of the menstrual cycle on energy intake. Nutrition Reviews. https://academic.oup.com/nutritionreviews/article/83/3/e866/7713894
- Hurtova A, Gimunova M, Benickova M (2026). Resting metabolic rate fluctuations across the menstrual cycle. Frontiers in Physiology. https://doaj.org/article/087d2bf4caf04440ae66ec7b61b9feb8
- Benton MJ, Hutchins AM, Dawes JJ (2020). Effect of menstrual cycle on resting metabolism. PLoS ONE. https://doaj.org/article/c6b8fe0940bf4dfc904a51f04cd15d80
- Bruinvels G et al. (2016). Prevalence and impact of heavy menstrual bleeding in athletes. BJSM. https://research.stmarys.ac.uk/id/eprint/944/1/Bruinvels-Burden-Brown-Richards-Pedlar-Prevalence-Impact-Heavy-Menstrual-Bleeding.pdf
- Pedlar CR, Brugnara C, Bruinvels G, Burden R (2018). Iron balance and iron supplementation for the female athlete. European Journal of Sport Science. https://research.stmarys.ac.uk/id/eprint/1970/1/Pedlar%20et%20al%202017%20Iron%20Female%20Athlete%20Review%20EJSS.pdf
- Abdi F et al. (2019). A systematic review of the role of vitamin D and calcium in premenstrual syndrome. Obstet Gynecol Sci. https://pmc.ncbi.nlm.nih.gov/articles/PMC6422848
- Mountjoy M et al. (2023). IOC consensus statement on Relative Energy Deficiency in Sport (REDs). BJSM. https://forening.sls.se/media/a4cl4crj/idrottsnutrition_2023-ioc-consenses-on-red-s-1.pdf
- Examine.com. Is seed cycling beneficial for hormonal health? https://examine.com/conditions/menstrual-health/faq/is-seed-cycling-beneficial-for-hormonal-health
- Mayo Clinic. Heavy menstrual bleeding: symptoms and causes. https://mayoclinic.org/diseases-conditions/menorrhagia/symptoms-causes/syc-20352829
