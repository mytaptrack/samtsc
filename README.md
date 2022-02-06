# samtsc
This project was put together to make working with the AWS SAM framework easier for developers. It simplifies working with the SAM framework, using real-time updates to lambda functions, layers and resources.  This is done by **samtsc** connecting to the template.yaml or template.yml file, then watching the serverless functions and layers defined.

# Prerequisites
To use **samtsc** you must have the following in the folder that is running **samtsc**

- template.yaml or template.yml
- samconfig.toml
- bash in your path (this is used for some system interactions)

### Windows Users
This project attempts to find a bash.exe to use with your system either in the C:\Windows\System directory or in the C:\Program Files\Git\bin directory.  It will attempt to add the bash.exe to the path within this project.


# Installing **samtsc**
To install **samtsc** run the following command in your project.

```!bash
npm i samtsc
```

# Running **samtsc**
To run samtsc use the following command

### Global Installation
```!bash
samtsc
```

### Local Installation
```!bash
npx samtsc
```

# Parameters
Any value in the samconfig.toml can be overridden by attaching -- before the variable name.  Other than that the following allow you to make it easier to configure and deploy the framework

| Parameter | Description | samconfig.toml variable name |
| --- | --- | --- |
| --environment | The name of the environment to deploy to | environment = "name of environment" |
| --base-stack | The base stack name to use to construct the stack name to deploy.  If no stack-name is specified then a stack name is created using the format '${base-stack}-${environment}' | base_stack = "base-stack-name" |
| --env-aware | This value leverages the environment to replace "&lt;EnvironmentName&gt;" in the parameter defaults with the environment name. | env_aware = "true" |
| --parm-layer | This flag configures the system to identify parameters which refer to layers and replaces them to pass layer validation in the SAM framework | parm_layer = "true" |
| --deploy-only | This flag configures the system to only deploy then exit | deploy_only = "true" |
| --build-only | This flag configures the system to only build then exit | build_only = "true" |
| --skip-init-deploy | This flag skips the initial SAM deployment speeding the start time.  The negative aspect is that if there are new resources, they won't be deployed which could cause debugging issues | skip_init_deploy = "true" |
| --stack_reference_layer stackLayerResourceName | This property leverages the prod dependencies defined in the root package.json to construct the dependencies in the layer.  Installing dependencies at the root also makes those dependencies available for all your lambda functions. | stack_reference_layer = "stackLayerResourceName" |
| --include_in_builddir | This value is a comma delimted list of directories to copy to the build directory | include_in_builddir = "./path1,./path2" |
| --s3-bucket-parm | This is the name of a parameter store entry which contains the deployment bucket | s3_bucket_parm = "/deployment/bucket/name" |
| --package | This flag forces samtsc to package all components for deployment and create cloudformation configuration files which can be used to deploy the cloudformation to multiple environments | N/A |
| -environments | This flag allows multiple environment cloudformation environment configuration files to be created for deployment pipelines | environments = "test,prod" |

# Developer Stack
When multiple developers are working on the same stack, it can get challenging if they overwrite each other's changes.  For this purpose, developers can use the file
"dev.stack.txt".  In this file the developer should supply an identifier such as initials, with no spaces.  This text will be added to the end of the stack name allowing
the developer to easily deploy to their own copy of the stack.

It is recommended that the "dev.stack.txt" file be added to the .gitignore file so that this value isn't used in any builds.

"dev.stack.txt" Example:
```txt
dev1
```

Stack Name: {mystackname}-{env}-dev1


# Global Permissions
At times its important that all functions in a stack have the same set of permissions to common resources.  In samtsc, the Global Function has been expanded to include Policies.  Policy statements can be added to this section in the same way that they would be added to the AWS::Serverless::Function.  These policies will be merged into every function in the stack.

```yml
Globals:
   Function:
      Policies:
         - Statement:
            - Effect: Allow
              Action: s3:GetObject
              Resource: '*'
```

# Process Hooks
samtsc creates hooks for allowing your own processing to take place around some of the different operations that are performed.  These hooks leverage npm as a plugin definition source and allow you to leverage any tools, scripting or other capabilities you wish to use.

## Defining a hook
Add your hooks to the package.json file.
``` json
{
   "scripts": {
      "samtsc-pre-copy-includes": "your script"
   }
}
```
samtsc then executes the script and sets the environment variable **"config"** with the json configuration being used combining the samconfig.toml with any command line parameters passed in.

``` js
const config = JSON.parse(process.env.config);
```

## Existing hooks
- samtsc-pre-copy-includes
- samtsc-post-copy-includes
- samtsc-pre-load-template
- samtsc-post-load-template


# What to expect
When **samtsc** is first started, it will load your template file and if necessary will attempt to compile your sources to the ".build" directory in your project.  After building the project, **samtsc** will then deploy the full project using the configurations located in the samconfig.toml file.

After the first deployment is complete the system will monitor file changes and compile and deploy only the functions that change.  If a layer is changed then **samtsc** will build the layer update and deploy the update across all the local functions in the stack that use that layer.

# Parameter Management
samtsc can help you manage your parameter store values more easily. This is done by using samtsc to extract your parameter store into a yaml file, which will supply a representation of your parameter store in a yaml format. After extracting, you can manage your parameters on either a per environment basis, or by having a single set of parameters across all your environments, and then overwriting those values on a per environment basis.

This allows teams to manage parameters in source control for integrations and manage their environments more easily while still benefiting from the capabilities of the aws parameter store.

## Parameters
| required | samconfig.toml | parameter | description |
| --- | --- | --- | --- |
| no | params_output | --params-output | The output file or directory for the parameters file to be extracted to |
| no | params_dir | --params-dir | The output directory for the parameters file to be extracted to. Output file will be named params_${environment name}.yml |
| no | params_keys | --params-keys | Use this option to specify a comma delimited list of keys to be extracted and imported. The when /env/ is used, it will be modified to the environment name being exported or imported into.
| no | params_clean | --params-clean | Set this value to true in order to remove keys previously set but no longer present in the configuration. This will also remove values created by other sources, so only use it if you know what you're doing.


## Extracting parameters
Either set your parameters in your samconfig.toml or pass them in as parameters.

``` !bash
samtsc params get
```

## Importing parameters
Importing parameters will merge your existing parameters from your file with the parameters already stored in your parameter store. This is not true if you use clean.

To import your parameters run the following command.
``` !bash
samtsc params put
```

### Rollups
As part of putting your parameters into parameter store, values will automatically get rolled up as well in JSON.

Example:
``` yml
test:
   val1: 1
   val2: "Test 2"
```
Becomes the following parameters:
- /test = '{ "val1": 1, "val2": "Test 2"}'
- /test/val1 = '1'
- /test/val2 = 'Test 2'

This allows services to access either a single value or multiple values with ease.

# Package
The "--package" command will automatically construct a dist/cloudformation directory off the root of the project. This directory has many aspects of a typical build directory created by SAM, with the addition of "template-&lt;Environment&gt;.config" files. These files can be passed into cloudformation in order to provide environment specific configurations.

### The following:
``` !bash
samtsc --package --environments test,prod
```
### Produces the following file structure:
``` yaml
dist:
   cloudformation:
      template.yaml
      template-test.config
      template-prod.config
      ...
```
When putting together CodePipelines, the artifact base directory should reference "dist/cloudformation", collecting all files and subdirectories.

# Nested Stack Architecture
Nested stacks which use SSM parameter references have their properties pulled to the parent stack and set as new parameters which get passed to the substack. This allows these parameters to be environment aware (&lt;EnvironmentName&gt;) in how they reference SSM Parameters, while still enabling a single built for multiple environments.