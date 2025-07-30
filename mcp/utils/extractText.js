const fs = require('fs').promises;
const path = require('path');

/**
 * Extract text content from various file formats
 * @param {string} filePath - Path to the uploaded file
 * @param {string} originalName - Original filename for format detection
 * @returns {Promise<string>} Extracted text content
 */
async function extractText(filePath, originalName) {
  try {
    const ext = path.extname(originalName).toLowerCase();
    const content = await fs.readFile(filePath, 'utf8');
    
    switch (ext) {
      case '.json':
        return extractFromJson(content);
      case '.sql':
        return extractFromSql(content);
      case '.prisma':
        return extractFromPrisma(content);
      case '.csv':
        return extractFromCsv(content);
      case '.php':
        return extractFromPhp(content);
      case '.go':
        return extractFromGo(content);
      case '.java':
        return extractFromJava(content);
      case '.js':
      case '.ts':
        return extractFromJavaScript(content);
      case '.py':
        return extractFromPython(content);
      case '.xml':
        return extractFromXml(content);
      case '.yaml':
      case '.yml':
        return extractFromYaml(content);
      default:
       
        return content;
    }
  } catch (error) {
    console.error('Error extracting text:', error);
    throw new Error(`Failed to extract text from file: ${error.message}`);
  }
}


function extractFromJson(content) {
  try {
    const parsed = JSON.parse(content);
    
    
    if (parsed.$schema || parsed.type || parsed.properties) {
      return formatJsonSchema(parsed);
    }
    
 
    return JSON.stringify(parsed, null, 2);
  } catch (error) {
    
    return content;
  }
}

function formatJsonSchema(schema) {
  let result = '';
  
  if (schema.title) result += `Schema: ${schema.title}\n`;
  if (schema.description) result += `Description: ${schema.description}\n`;
  
  if (schema.properties) {
    result += '\nProperties:\n';
    for (const [key, prop] of Object.entries(schema.properties)) {
      result += `- ${key}: ${prop.type || 'any'}`;
      if (prop.description) result += ` - ${prop.description}`;
      result += '\n';
    }
  }
  
  if (schema.required) {
    result += `\nRequired fields: ${schema.required.join(', ')}\n`;
  }
  
  return result + '\n' + JSON.stringify(schema, null, 2);
}

function extractFromSql(content) {

  let result = 'SQL Database Schema:\n\n';
  

  const tableRegex = /CREATE\s+TABLE\s+(\w+)\s*\([^)]+\)/gi;
  const tables = content.match(tableRegex);
  
  if (tables) {
    result += 'Tables found:\n';
    tables.forEach(table => {
      result += table + '\n\n';
    });
  }
  
  return result + content;
}

/**
 * Extract schema from Prisma files
 */
function extractFromPrisma(content) {
  let result = 'Prisma Database Schema:\n\n';
  
  // Extract models
  const modelRegex = /model\s+(\w+)\s*{[^}]+}/g;
  const models = content.match(modelRegex);
  
  if (models) {
    result += 'Models defined:\n';
    models.forEach(model => {
      result += model + '\n\n';
    });
  }
  
  return result + content;
}

/**
 * Extract headers and structure from CSV files
 */
function extractFromCsv(content) {
  const lines = content.split('\n');
  let result = 'CSV Data Structure:\n\n';
  
  if (lines.length > 0) {
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    result += `Columns: ${headers.join(', ')}\n\n`;
    
    // Include sample data (first few rows)
    result += 'Sample data:\n';
    result += lines.slice(0, Math.min(5, lines.length)).join('\n');
  }
  
  return result;
}

/**
 * Extract class definitions from PHP files
 */
function extractFromPhp(content) {
  let result = 'PHP Code Structure:\n\n';
  
  // Extract class definitions
  const classRegex = /class\s+(\w+)[^{]*{[^}]*}/g;
  const classes = content.match(classRegex);
  
  if (classes) {
    result += 'Classes found:\n';
    classes.forEach(cls => {
      result += cls + '\n\n';
    });
  }
  
  return result + content;
}

/**
 * Extract struct definitions from Go files
 */
function extractFromGo(content) {
  let result = 'Go Code Structure:\n\n';
  
  // Extract struct definitions
  const structRegex = /type\s+(\w+)\s+struct\s*{[^}]+}/g;
  const structs = content.match(structRegex);
  
  if (structs) {
    result += 'Structs found:\n';
    structs.forEach(struct => {
      result += struct + '\n\n';
    });
  }
  
  return result + content;
}

/**
 * Extract class definitions from Java files
 */
function extractFromJava(content) {
  let result = 'Java Code Structure:\n\n';
  
  // Extract class definitions
  const classRegex = /(public\s+)?class\s+(\w+)[^{]*{/g;
  let match;
  const classes = [];
  
  while ((match = classRegex.exec(content)) !== null) {
    classes.push(match[0]);
  }
  
  if (classes.length > 0) {
    result += 'Classes found:\n';
    classes.forEach(cls => {
      result += cls + '\n';
    });
    result += '\n';
  }
  
  return result + content;
}

/**
 * Extract interfaces and types from JavaScript/TypeScript
 */
function extractFromJavaScript(content) {
  let result = 'JavaScript/TypeScript Structure:\n\n';
  
  // Extract interface definitions (TypeScript)
  const interfaceRegex = /interface\s+(\w+)[^{]*{[^}]+}/g;
  const interfaces = content.match(interfaceRegex);
  
  if (interfaces) {
    result += 'Interfaces found:\n';
    interfaces.forEach(iface => {
      result += iface + '\n\n';
    });
  }
  
  // Extract type definitions
  const typeRegex = /type\s+(\w+)\s*=[^;]+;/g;
  const types = content.match(typeRegex);
  
  if (types) {
    result += 'Type definitions:\n';
    types.forEach(type => {
      result += type + '\n';
    });
  }
  
  return result + content;
}

function extractFromPython(content) {
  let result = 'Python Code Structure:\n\n';
  
  const classRegex = /class\s+(\w+)[^:]*:/g;
  const classes = content.match(classRegex);
  
  if (classes) {
    result += 'Classes found:\n';
    classes.forEach(cls => {
      result += cls + '\n';
    });
    result += '\n';
  }
  
  return result + content;
}


function extractFromXml(content) {
  let result = 'XML Structure:\n\n';
  

  const rootRegex = /<(\w+)[^>]*>/;
  const rootMatch = content.match(rootRegex);
  
  if (rootMatch) {
    result += `Root element: ${rootMatch[1]}\n\n`;
  }
  
  return result + content;
}


function extractFromYaml(content) {
  let result = 'YAML Configuration:\n\n';
  
  // Extract top-level keys
  const keyRegex = /^(\w+):/gm;
  const keys = [];
  let match;
  
  while ((match = keyRegex.exec(content)) !== null) {
    keys.push(match[1]);
  }
  
  if (keys.length > 0) {
    result += `Top-level keys: ${keys.join(', ')}\n\n`;
  }
  
  return result + content;
}

module.exports = { extractText };