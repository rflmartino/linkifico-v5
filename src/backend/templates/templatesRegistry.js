import { SIMPLE_WATERFALL_TEMPLATE } from './simple_waterfall.js';

export const TEMPLATES = {
	'simple_waterfall': SIMPLE_WATERFALL_TEMPLATE
};

export const getTemplate = (templateName) => {
	const tpl = TEMPLATES[templateName];
	if (!tpl) {
		throw new Error(`Template ${templateName} not found. Available: ${Object.keys(TEMPLATES).join(', ')}`);
	}
	return tpl;
};


