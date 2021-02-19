# samtsc
This project was put together to make working with teh AWS SAM framework easier for developers. It simplifies working with the SAM framework, using real-time updates to lambda functions, layers and resources.  This is done by **samtsc** connecting to the template.yaml or template.yml file, then watching the serverless functions and layers defined.

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


# What to expect
When **samtsc** is first started, it will load your template file and if necessary will attempt to compile your sources to the ".build" directory in your project.  After building the project, **samtsc** will then deploy the full project using the configurations located in the samconfig.toml file.

After the first deployment is complete the system will monitor file changes and compile and deploy only the functions that change.  If a layer is changed then **samtsc** will build the layer update and deploy the update across all the local functions in the stack that use that layer.
