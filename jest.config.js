// jest.config.js
module.exports = {
    verbose: true,
    testRegex: ".*(test|spec)\\.(t|j)sx?$",
    roots: [
        "./src"
    ],
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
    testEnvironment: "node",
    runner: 'jest-serial-runner'
};