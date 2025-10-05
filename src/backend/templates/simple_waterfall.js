export const SIMPLE_WATERFALL_TEMPLATE = {
	templateName: 'simple_waterfall',
	description: 'Simple 4-area waterfall-style template focused on essentials',
	areas: [
		{
			id: 'objectives',
			tier: 'basic',
			routingKeywords: ['goal', 'objective', 'purpose', 'why', 'outcome', 'success criteria'],
			shape: {
				description: '',
				goals: [],
				acceptanceCriteria: []
			}
		},
		{
			id: 'tasks',
			tier: 'basic',
			routingKeywords: ['task', 'todo', 'timeline', 'deadline', 'when', 'finish', 'schedule'],
			shape: {
				tasks: [],
				deadline: null,
				dependencies: []
			}
		},
		{
			id: 'budget',
			tier: 'basic',
			routingKeywords: ['budget', 'cost', 'price', 'funding', 'spend', 'expense'],
			shape: {
				total: null,
				spent: 0,
				lineItems: []
			}
		},
		{
			id: 'people',
			tier: 'basic',
			routingKeywords: ['people', 'team', 'owner', 'stakeholder', 'assign', 'who'],
			shape: {
				stakeholders: [],
				team: []
			}
		}
	]
};

export function isAreaUnlocked(areaTier, maturityLevel) {
	// For simple_waterfall, all areas are basic and always unlocked
	return true;
}


