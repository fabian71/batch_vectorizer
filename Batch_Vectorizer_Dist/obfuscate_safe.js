const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

console.log('🔒 Starting SAFE obfuscation process...\n');

// Files to obfuscate (ONLY background.js and popup.js)
const filesToObfuscate = [
    'background.js',
    'popup.js'
];

// Output directory
const outputDir = 'Batch_Vectorizer_Dist';

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`✅ Created output directory: ${outputDir}\n`);
}

// Obfuscation options - SAFE settings
const obfuscationOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false, // Disabled to avoid issues
    debugProtectionInterval: 0,
    disableConsoleOutput: false, // Keep console for debugging
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false, // Important: don't rename globals
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

// Obfuscate each file
filesToObfuscate.forEach(fileName => {
    try {
        const inputPath = path.join(__dirname, fileName);
        const outputPath = path.join(__dirname, outputDir, fileName);

        console.log(`🔄 Processing: ${fileName}`);

        // Read the source file
        const sourceCode = fs.readFileSync(inputPath, 'utf8');
        console.log(`   📖 Read ${sourceCode.length} bytes`);

        // Obfuscate
        const obfuscationResult = JavaScriptObfuscator.obfuscate(sourceCode, obfuscationOptions);
        const obfuscatedCode = obfuscationResult.getObfuscatedCode();
        console.log(`   🔐 Obfuscated to ${obfuscatedCode.length} bytes`);

        // Write obfuscated file
        fs.writeFileSync(outputPath, obfuscatedCode, 'utf8');
        console.log(`   ✅ Saved to: ${outputPath}\n`);

    } catch (error) {
        console.error(`   ❌ Error processing ${fileName}:`, error.message);
        process.exit(1);
    }
});

// Copy non-obfuscated files
const filesToCopy = [
    'content.js',      // DO NOT obfuscate - interacts with external DOM
    'locales.js',      // DO NOT obfuscate - just translations
    'manifest.json',
    'popup.html'
];

console.log('📋 Copying non-obfuscated files...\n');

filesToCopy.forEach(fileName => {
    try {
        const sourcePath = path.join(__dirname, fileName);
        const destPath = path.join(__dirname, outputDir, fileName);

        if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, destPath);
            console.log(`   ✅ Copied: ${fileName}`);
        } else {
            console.log(`   ⚠️  Not found: ${fileName}`);
        }
    } catch (error) {
        console.error(`   ❌ Error copying ${fileName}:`, error.message);
    }
});

// Copy directories (assets, icons)
const dirsToCopy = ['assets', 'icons'];

console.log('\n📁 Copying directories...\n');

dirsToCopy.forEach(dirName => {
    try {
        const sourceDir = path.join(__dirname, dirName);
        const destDir = path.join(__dirname, outputDir, dirName);

        if (fs.existsSync(sourceDir)) {
            // Create destination directory
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            // Copy all files in directory
            const files = fs.readdirSync(sourceDir);
            files.forEach(file => {
                const srcFile = path.join(sourceDir, file);
                const destFile = path.join(destDir, file);

                if (fs.statSync(srcFile).isFile()) {
                    fs.copyFileSync(srcFile, destFile);
                }
            });

            console.log(`   ✅ Copied directory: ${dirName} (${files.length} files)`);
        } else {
            console.log(`   ⚠️  Directory not found: ${dirName}`);
        }
    } catch (error) {
        console.error(`   ❌ Error copying directory ${dirName}:`, error.message);
    }
});

console.log('\n✨ Obfuscation completed successfully!');
console.log(`\n📦 Output directory: ${path.join(__dirname, outputDir)}`);
console.log('\n🔒 Obfuscated files:');
filesToObfuscate.forEach(f => console.log(`   - ${f}`));
console.log('\n📄 Non-obfuscated files (preserved):');
filesToCopy.forEach(f => console.log(`   - ${f}`));
console.log('\n✅ Extension is ready for distribution!');
