// Compromise-based Sentiment Analysis
// Simple, reliable sentiment detection using compromise library

import nlp from 'compromise';
import { Logger } from '../utils/logger.js';

/**
 * Sentiment Analysis using Compromise
 * Lightweight, reliable, and already working in Wix Studio
 */
class CompromiseSentiment {
    constructor() {
        this.isInitialized = false;
        this.sentimentPatterns = this.initializeSentimentPatterns();
        Logger.log('compromiseSentiment', 'constructor', 'Compromise sentiment analyzer initialized');
    }

    /**
     * Map detected sentiment to a verbosity instruction for Haiku
     * Returns one of: 'terse' | 'normal' | 'detailed'
     */
    getVerbosityInstructionFromSentiment(sentiment) {
        switch (sentiment) {
            case 'impatient':
            case 'frustrated':
                return 'terse';
            case 'engaged':
            case 'grateful':
            case 'professional':
                return 'normal';
            case 'thoughtful':
            case 'confused':
                return 'detailed';
            case 'casual':
            case 'neutral':
            default:
                return 'normal';
        }
    }

    /**
     * Analyze text and return Haiku-facing guidance
     * - sentiment, confidence, guidance object, and verbosityInstruction
     */
    analyzeForHaiku(text) {
        const sentimentResult = this.analyzeSentiment(text);
        const guidance = this.getSentimentGuidance(sentimentResult);
        const verbosityInstruction = this.getVerbosityInstructionFromSentiment(sentimentResult.sentiment);

        return {
            success: true,
            sentiment: sentimentResult.sentiment,
            confidence: sentimentResult.confidence,
            verbosityInstruction,
            guidance,
            details: sentimentResult.details,
            originalText: text
        };
    }

    /**
     * Initialize sentiment patterns for different emotional states
     */
    initializeSentimentPatterns() {
        return {
            // Engaged/Positive
            engaged: [
                'good', 'great', 'excellent', 'perfect', 'awesome', 'wonderful', 'fantastic',
                'brilliant', 'amazing', 'outstanding', 'superb', 'terrific', 'marvelous',
                'yes', 'yeah', 'yep', 'absolutely', 'definitely', 'sure', 'okay', 'ok',
                'sounds good', 'looks good', 'perfect', 'exactly', 'right', 'correct',
                'love it', 'like it', 'enjoy', 'pleased', 'happy', 'satisfied'
            ],
            
            // Frustrated/Negative
            frustrated: [
                'bad', 'terrible', 'awful', 'horrible', 'annoying', 'frustrating', 'irritating',
                'wrong', 'incorrect', 'mistake', 'error', 'problem', 'issue', 'trouble',
                'hate', 'dislike', 'angry', 'mad', 'upset', 'disappointed', 'furious',
                'not working', 'broken', 'failed', 'useless', 'stupid', 'ridiculous',
                'no', 'nope', 'never', 'stop', 'quit', 'enough', 'whatever'
            ],
            
            // Confused/Uncertain
            confused: [
                'confused', 'lost', 'unclear', 'unclear', 'uncertain', 'unsure', 'doubt',
                'don\'t understand', 'don\'t know', 'not sure', 'maybe', 'perhaps',
                'what', 'how', 'why', 'where', 'when', 'which', 'who',
                'explain', 'clarify', 'help', 'guide', 'show me', 'tell me'
            ],
            
            // Impatient/Rushed
            impatient: [
                'hurry', 'quick', 'fast', 'speed', 'rush', 'impatient', 'urgent',
                'skip', 'jump', 'leap', 'dash', 'sprint', 'race', 'zoom',
                'now', 'immediately', 'asap', 'right now', 'quickly', 'fast',
                'no time', 'busy', 'in a rush', 'pressed for time'
            ],
            
            // Professional/Formal
            professional: [
                'please', 'kindly', 'respectfully', 'professionally', 'formally',
                'appreciate', 'grateful', 'thank you', 'thanks', 'regards',
                'sincerely', 'best regards', 'yours truly', 'respectfully yours',
                'would like', 'would appreciate', 'could you', 'may I', 'shall we'
            ],
            
            // Casual/Informal
            casual: [
                'hey', 'hi', 'hello', 'yo', 'sup', 'what\'s up', 'howdy',
                'cool', 'nice', 'sweet', 'awesome', 'rad', 'neat', 'wicked',
                'yeah', 'yep', 'sure', 'ok', 'alright', 'fine', 'whatever',
                'no worries', 'no problem', 'it\'s all good', 'chill', 'relax'
            ],
            
            // Thoughtful/Reflective
            thoughtful: [
                'think', 'consider', 'reflect', 'ponder', 'contemplate', 'mull over',
                'interesting', 'fascinating', 'intriguing', 'curious', 'wonder',
                'let me think', 'give me a moment', 'need to consider', 'weigh options',
                'hmm', 'well', 'actually', 'on second thought', 'perhaps'
            ],
            
            // Grateful/Appreciative
            grateful: [
                'thank you', 'thanks', 'appreciate', 'grateful', 'blessed', 'fortunate',
                'helpful', 'useful', 'valuable', 'beneficial', 'supportive',
                'couldn\'t have done it without', 'lifesaver', 'hero', 'amazing help',
                'much appreciated', 'deeply grateful', 'eternally thankful'
            ],
            
            // Neutral
            neutral: [
                'okay', 'ok', 'fine', 'alright', 'acceptable', 'decent', 'average',
                'normal', 'standard', 'typical', 'regular', 'ordinary', 'common',
                'maybe', 'perhaps', 'possibly', 'might', 'could be', 'seems like'
            ]
        };
    }

    /**
     * Analyze sentiment of input text
     */
    analyzeSentiment(text) {
        try {
            if (!text || typeof text !== 'string') {
                return { sentiment: 'neutral', confidence: 0.5, details: {} };
            }

            const doc = nlp(text.toLowerCase());
            const sentimentScores = {};
            const details = {};

            // Score each sentiment category
            for (const [sentiment, patterns] of Object.entries(this.sentimentPatterns)) {
                let score = 0;
                const foundPatterns = [];

                for (const pattern of patterns) {
                    const matches = doc.match(pattern).length;
                    if (matches > 0) {
                        score += matches;
                        foundPatterns.push(pattern);
                    }
                }

                sentimentScores[sentiment] = score;
                details[sentiment] = {
                    score,
                    patterns: foundPatterns,
                    count: foundPatterns.length
                };
            }

            // Find the dominant sentiment
            const dominantSentiment = Object.keys(sentimentScores).reduce((a, b) => 
                sentimentScores[a] > sentimentScores[b] ? a : b
            );

            // Calculate confidence based on score distribution
            const totalScore = Object.values(sentimentScores).reduce((a, b) => a + b, 0);
            const confidence = totalScore > 0 ? sentimentScores[dominantSentiment] / totalScore : 0.5;

            // Handle negation (e.g., "not good" should be negative)
            const negatedSentiment = this.handleNegation(doc, dominantSentiment, sentimentScores);

            const result = {
                sentiment: negatedSentiment.sentiment,
                confidence: Math.max(0.1, Math.min(0.95, negatedSentiment.confidence)),
                details: {
                    ...details,
                    originalSentiment: dominantSentiment,
                    negationApplied: negatedSentiment.negationApplied
                },
                originalText: text
            };

            Logger.log('compromiseSentiment', 'analyzeSentiment', 
                `"${text.substring(0, 50)}..." -> ${result.sentiment} (${(result.confidence * 100).toFixed(1)}%)`);

            return result;

        } catch (error) {
            Logger.error('compromiseSentiment', 'analyzeSentiment', error);
            return { 
                sentiment: 'neutral', 
                confidence: 0.5, 
                details: { error: error.message },
                originalText: text
            };
        }
    }

    /**
     * Handle negation in text (e.g., "not good" -> negative)
     */
    handleNegation(doc, dominantSentiment, sentimentScores) {
        const negationWords = ['not', 'no', 'never', 'none', 'nothing', 'nowhere', 'neither', 'nor'];
        const hasNegation = negationWords.some(word => doc.has(word));

        if (hasNegation && dominantSentiment === 'engaged') {
            return {
                sentiment: 'frustrated',
                confidence: Math.max(0.6, sentimentScores.engaged * 0.8),
                negationApplied: true
            };
        }

        if (hasNegation && dominantSentiment === 'frustrated') {
            return {
                sentiment: 'engaged',
                confidence: Math.max(0.6, sentimentScores.frustrated * 0.8),
                negationApplied: true
            };
        }

        return {
            sentiment: dominantSentiment,
            confidence: sentimentScores[dominantSentiment] / Math.max(1, Object.values(sentimentScores).reduce((a, b) => a + b, 0)),
            negationApplied: false
        };
    }

    /**
     * Get sentiment guidance based on detected sentiment
     */
    getSentimentGuidance(sentimentResult) {
        const guidance = {
            engaged: {
                action: 'continue',
                message: 'User is engaged and positive. Continue with current approach.',
                tone: 'enthusiastic',
                nextSteps: ['proceed with confidence', 'maintain momentum', 'build on success']
            },
            frustrated: {
                action: 'help',
                message: 'User is frustrated. Provide clear help and simplify approach.',
                tone: 'supportive',
                nextSteps: ['acknowledge frustration', 'offer solutions', 'simplify process']
            },
            confused: {
                action: 'clarify',
                message: 'User is confused. Provide clear explanations and guidance.',
                tone: 'patient',
                nextSteps: ['explain clearly', 'provide examples', 'ask clarifying questions']
            },
            impatient: {
                action: 'speed_up',
                message: 'User is impatient. Focus on quick, efficient solutions.',
                tone: 'direct',
                nextSteps: ['get to the point', 'skip unnecessary details', 'provide quick wins']
            },
            professional: {
                action: 'formal',
                message: 'User prefers professional communication. Use formal tone.',
                tone: 'professional',
                nextSteps: ['use formal language', 'be thorough', 'provide detailed information']
            },
            casual: {
                action: 'relaxed',
                message: 'User prefers casual communication. Use friendly, relaxed tone.',
                tone: 'casual',
                nextSteps: ['be friendly', 'use simple language', 'keep it light']
            },
            thoughtful: {
                action: 'explore',
                message: 'User is thoughtful. Encourage exploration and provide options.',
                tone: 'encouraging',
                nextSteps: ['present options', 'encourage thinking', 'provide detailed analysis']
            },
            grateful: {
                action: 'acknowledge',
                message: 'User is grateful. Acknowledge appreciation and continue helping.',
                tone: 'warm',
                nextSteps: ['acknowledge thanks', 'continue helping', 'maintain positive relationship']
            },
            neutral: {
                action: 'assess',
                message: 'User sentiment is neutral. Gather more information to understand needs.',
                tone: 'neutral',
                nextSteps: ['ask questions', 'gather information', 'assess needs']
            }
        };

        return guidance[sentimentResult.sentiment] || guidance.neutral;
    }

    /**
     * Test the sentiment analysis with sample inputs
     */
    testSentimentAnalysis() {
        const testCases = [
            'yes perfect lets do that',
            'this is so annoying',
            'i dont understand what you mean',
            'hurry up please',
            'please proceed with the next step',
            'yeah sure whatever',
            'let me think about that',
            'thank you so much',
            'okay that sounds fine'
        ];

        const results = testCases.map(testCase => {
            const result = this.analyzeSentiment(testCase);
            return {
                input: testCase,
                sentiment: result.sentiment,
                confidence: result.confidence,
                guidance: this.getSentimentGuidance(result)
            };
        });

        Logger.log('compromiseSentiment', 'testSentimentAnalysis', 
            `Tested ${testCases.length} cases successfully`);

        return results;
    }

    /**
     * Initialize the sentiment analyzer
     */
    async initialize() {
        try {
            this.isInitialized = true;
            Logger.log('compromiseSentiment', 'initialize', 'Compromise sentiment analyzer ready');
            return { success: true, message: 'Compromise sentiment analyzer initialized' };
        } catch (error) {
            Logger.error('compromiseSentiment', 'initialize', error);
            return { success: false, message: error.message };
        }
    }
}

// Export singleton instance
export default new CompromiseSentiment();
