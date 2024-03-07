#!/bin/bash
echo "Running tests for vodev"

# This is a correct syntax call.
#cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c account=483713007265 -c region=$AWS_REGION


echo "------------------------------------------------------------------------------------------------------------------"
echo "Expecting error due to short vpcId"
set -x
cdk deploy -c vpcId=vpc-0da -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c account=483713007265 -c region=$AWS_REGION
set +x
echo "------------------------------------------------------------------------------------------------------------------"

echo "Expecting error due to vpcId not starting with vpc-"
set -x
cdk deploy -c vpcId=0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c account=483713007265 -c region=$AWS_REGION
set +x

echo "------------------------------------------------------------------------------------------------------------------"
echo "Expecting error due to missing vpcId"
set -x
cdk deploy -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c account=483713007265 -c region=$AWS_REGION
set +x

echo "------------------------------------------------------------------------------------------------------------------"
echo "Expecting error due to missing redundant privateSubnetIds"
set -x
cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c account=483713007265 -c region=$AWS_REGION
set +x

echo "------------------------------------------------------------------------------------------------------------------"
echo "Expecting error due to subnet not starting with subnet-"
set -x
cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09,08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c account=483713007265 -c region=$AWS_REGION
set +x

echo "------------------------------------------------------------------------------------------------------------------"
echo "Expecting error due to missing privateSubnetIds"
set -x
cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c account=483713007265 -c region=$AWS_REGION
set +x

echo "------------------------------------------------------------------------------------------------------------------"
echo "Expecting error due to missing redundant availabilityZones"
set -x
cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=us-west-2a -c account=483713007265 -c region=$AWS_REGION
set +x

echo "------------------------------------------------------------------------------------------------------------------"
echo "Expecting error due to availabilityZones not following format xx-xxxx-0x"
set -x
cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=uswest2a,us-west-2b,us-west-2c -c account=483713007265 -c region=$AWS_REGION
set +x

echo "------------------------------------------------------------------------------------------------------------------"
echo "Expecting error due to missing availabilityZones"
set -x
cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c account=483713007265 -c region=$AWS_REGION
set +x

echo "------------------------------------------------------------------------------------------------------------------"
echo "


Expecting error due to non numeric account"
set -x
cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c account=483qyU007265 -c region=$AWS_REGION
set +x

echo "-----------------------------------------------------------------------------------------------------------"
echo "Expecting error due to short account"
set -x
cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c account=123 -c region=$AWS_REGION
set +x

echo "------------------------------------------------------------------------------------------------------------------"
echo "Expecting error due to missing account"
set -x
cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c region=$AWS_REGION
set +x

echo "------------------------------------------------------------------------------------------------------------------"
echo "Expecting error due to missing region"
set -x
cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c account=483713007265
set +x

echo "------------------------------------------------------------------------------------------------------------------"
echo "Expecting error due to non existing region"
set -x
cdk deploy -c vpcId=vpc-0dac458b5d1542764 -c privateSubnetIds=subnet-00cd7a0602e4f0f09,subnet-08e5109899e63da57,subnet-042e37e02217a69d3 -c availabilityZones=us-west-2a,us-west-2b,us-west-2c -c account=483713007265 -c region=ohio
set +x

