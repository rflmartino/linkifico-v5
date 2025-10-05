import axios from 'axios';

const RAILWAY_URL = 'https://linkifico-v5-production.up.railway.app';

// Test Railway connection - Web Method
export async function testRailwayConnection() {
    try {
        const response = await axios.get(`${RAILWAY_URL}/health`, {
            timeout: 10000
        });
        
        return {
            success: true,
            message: 'Railway connection successful',
            data: response.data,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            success: false,
            message: 'Railway connection failed',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

// Analyze project via Railway - Web Method
export async function analyzeProjectViaRailway(projectData) {
    try {
        const response = await axios.post(`${RAILWAY_URL}/api/analyze-project`, {
            projectData
        }, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        return {
            success: true,
            message: 'Analysis completed via Railway',
            data: response.data,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            success: false,
            message: 'Analysis failed',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

// Generic Railway API call - Web Method
export async function callRailwayAPI(endpoint, method = 'GET', data = null) {
    try {
        const config = {
            method,
            url: `${RAILWAY_URL}${endpoint}`,
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        if (data) {
            config.data = data;
        }
        
        const response = await axios(config);
        
        return {
            success: true,
            data: response.data,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            success: false,
            message: 'Railway API call failed',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}
