// Helper function to parse LangChain response content
// Handles both string and array content types

export function parseResponseContent(response) {
  try {
    // Handle content as string or array
    let contentText = typeof response.content === 'string' 
      ? response.content 
      : (Array.isArray(response.content) && response.content.length > 0)
        ? response.content[0].text || JSON.stringify(response.content)
        : JSON.stringify(response.content);
    
    // Remove markdown code blocks
    const cleanContent = contentText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    
    return JSON.parse(cleanContent);
  } catch (error) {
    console.error("Failed to parse response content:", error);
    console.error("Response content type:", typeof response.content);
    console.error("Response content:", response.content);
    throw error;
  }
}

